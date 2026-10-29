# Spec #165: Notify: deliver at least once

## Goal
pulse-notify keeps its documented promise: every incident event is delivered to every channel at least once, across receiver outages of minutes and across restarts, and no malformed input or I/O error stops the process or the polling.

## Scope
Only `notify` changes. No contract or API change (the idempotency key `<incidentId>:<event>` and the notification shape stay). All findings of the issue were verified against `notify` main (see `issue-review.md`).

## Non-goals
- No webhook signing. No change to incident filter semantics or key format.
- No parallel delivery per channel: one FIFO per channel stays, so a long retry blocks later events on that channel (order preserved, documented).

## Decisions (the plan decides the open points)
1. **Resend source: persist the notification in the ledger.** The ledger file stays `version: 1` and gains an optional top-level `payloads: { [channel]: { [key]: Notification } }`. `claim` stores the payload together with `pending`; `settle` removes it. A file without `payloads` loads as before. Legacy `pending` keys without payload (written by the old version): the poll rebuilds the notification from the API incident (key `<id>:<event>`), enqueues it and keeps the key `pending`; if the incident is no longer returned, log an error naming channel and key once per start and leave it `pending`.
2. **Retry schedule: exponential, capped, finite by default, configurable.** Delay before retry n (n = 1, 2, ...) is `min(initial * 2^(n-1), max)`, no jitter. Env:
   - `PULSE_NOTIFY_RETRY_DELAY_MS` (default `1000`): initial delay, existing variable keeps working with this meaning.
   - `PULSE_NOTIFY_RETRY_MAX_DELAY_MS` (default `60000`): cap, must be >= initial delay.
   - `PULSE_NOTIFY_RETRY_ATTEMPTS` (default `12`): total attempts per event; `0` means retry without end.
   Default: delays 1, 2, 4, 8, 16, 32, 60, 60, 60, 60, 60 s = about 6 min. After the last attempt the key is settled `failed` as today and is not resent on restart (documented). Invalid values are a `ConfigError` (exit 2).
3. **Malformed API data: skip the incident, log, keep polling.** Validate each incident at the edge (`id`, `checkId` strings; `openedAt` finite number; `resolvedAt` finite number when resolved). A bad incident is skipped with an `error` log naming `incidentId` and the reason; it creates no ledger entry and is re-evaluated each poll. Log dedupe: log each incident id once per process. Other incidents of the same poll are still processed.
4. **Ledger write errors.** Error on `claim`: event not sent, logged with channel and key, stays unrecorded, retried by the next poll. Error on `settle` after a successful send: logged, key stays `pending`, so it is resent at the next start (duplicate possible, deduplicated by key at the receiver). Error on `seed`: logged, channel stays unseeded, retried next poll. `tick()` and the drain loop never reject.
5. **Shutdown.** `Notifier.stop()` returns a promise: stops polling, aborts in-flight sleeps and in-flight sends through an `AbortSignal`, leaves unfinished keys `pending`, and resolves when the workers are done. The SIGINT/SIGTERM handler awaits it with a bound (5 s), then exits with 0 without `process.exit` racing a ledger write. `main` takes injectable `process`/`exit` for tests.
6. **Resend on start.** `start()` enqueues all ledger `pending` entries that have a payload per channel, oldest first, before the first poll, and adds their keys to the channel's `queued` set so the poll does not enqueue them twice. Resend applies only to channels already in the ledger; newly seeded channels are unaffected. Replace the "possibly lost" error log with an `info` log "resending pending notifications" with the count.
7. **Poll timeout covers the body.** `fetchWithTimeout` keeps the timer until the body is read: provide a helper that fetches and reads the JSON (or cancels the body) under one abort controller and one timer; the error text stays `timeout after <ms>ms`. The webhook sender does the same (consume or cancel the response body under the timeout). A failed or stalled poll is logged and the next poll is always scheduled (`.finally` guarded by a catch).
8. **Failure logs name channel and cause.** `error` strings come from a helper that walks the `err.cause` chain and adds fields `code` (e.g. `ECONNREFUSED`, `ENOTFOUND`, `CERT_HAS_EXPIRED`) and `cause` (message of the innermost cause). Delivery failure logs ("delivery attempt failed", "notification delivery failed") carry `channel`, `key`, `error`, `code`, `cause`; "api poll failed" carries `error`, `code`, `cause`.

## Risks
- Ledger format growth: payloads exist only while `pending`, so size stays small.
- Head-of-line blocking up to the full schedule on a dead channel; accepted, documented.
- Duplicate deliveries after crashes or settle errors: inherent to at-least-once, receivers dedupe by key.
- Bounded shutdown may leave a send in flight whose result is unknown: key stays `pending`, resent.

## Repository: notify

Files: `src/delivery.ts`, `src/notifier.ts`, `src/ledger.ts`, `src/config.ts`, `src/api.ts`, `src/timeout.ts`, `src/index.ts`, `src/channels/webhook.ts`, `src/types.ts`, a new `src/errors.ts` (cause chain helper, one job), tests in `test/`, docs.

Behavior: implement decisions 1-8 above. Follow the repository `AGENTS.md` (erasable TypeScript, injected `sleep`/`schedule`/`fetch`, no `any`, no non-null `!`). Fix the wrong "Never throws" comment by making it true.

Tests (each must fail on current main):
- Backoff: fake `sleep` records delays 1,2,4,...,cap; attempts honor `RETRY_ATTEMPTS`; `0` retries beyond 12; config parsing and errors for the new vars.
- A receiver down for longer than 4 attempts (e.g. 10 failures) then up: the event is delivered.
- Restart: a ledger with a `pending` entry and payload, new `Notifier.start()` delivers it once, settles `delivered`, and the poll does not enqueue it twice; legacy pending without payload is rebuilt from the API; ledger without `payloads` loads.
- Stop during a retry sleep: `stop()` resolves, key remains `pending`, no further send; `main` signal handler calls exit after stop resolves, and does not hang when stop is slow (bounded).
- Stalled API body (stream that never ends) hits `timeout after <ms>ms`, logs `api poll failed`, and the next poll still runs; same for a stalled webhook body.
- Malformed incident (`openedAt: NaN`/string): logged, other incidents delivered, no rejection (`process` `unhandledRejection` listener asserts none).
- Throwing ledger `claim`, `settle`, `seed`: logged, polling continues, no unhandled rejection, settle error leaves `pending`.
- Failure log contains `channel`, `code: ECONNREFUSED` and the cause for an error with `cause`.

Docs:
- `docs/channels.md`: precise guarantee: at least once per event and channel while the process runs within the retry schedule and across restarts for unfinished (`pending`) events; `failed` after the schedule is exhausted is final (unless `RETRY_ATTEMPTS=0`); duplicates possible, dedupe by idempotency key; FIFO per channel and head-of-line blocking; the retry schedule with the default table.
- `docs/configuration.md`: new variables and defaults; `PULSE_NOTIFY_TIMEOUT_MS` covers reading the body (API and webhook); initial-delay meaning of `RETRY_DELAY_MS`.
- `docs/operation.md`: resend on start, SIGTERM/SIGINT behavior and the 5 s bound, log fields `code`/`cause`, malformed data and ledger error handling. `docs/troubleshooting.md`: update the rows "possibly lost", "delivery failed", "not resent". README only if it repeats the guarantee.

Completion evidence: `npm run check` passes; the new tests fail when run against main's `src/`; docs match the decisions above.

## Acceptance evidence
With a receiver down for several minutes then up, every event of the outage reaches it (same idempotency key). After SIGTERM during an outage and a restart, unfinished events are delivered. A stalled or malformed poll, and a failing ledger write, log an error and polling continues without exit. A failed delivery log shows channel and cause code. Docs state the guarantee, body timeout and schedule.
