# Issue review: #255 Notify: permanent errors, resend, ledger and SMTP hardening

Only `notify` is affected (checked against `.repos/notify` main). `contract`, `api`, `probe`, `status`, `config` need no change. The spec needs a single target, `notify`, with no `dependsOn`.

## Findings checked against the code
- Confirmed: `delivery.ts#attempts` retries every error until the limit. Limit 0 retries forever.
- Confirmed: `smtp.ts#upgrade` resets only `#buffer`. `#replies` and `#partial` survive. `MAX_BUFFER` caps the buffer but not the number of lines in a multi-line reply (`#partial`) or the queued replies.
- Confirmed: `ledger.ts` does `structuredClone` plus a synchronous write and fsync on every `claim`, `settle` and `seed`. There is no pruning and no lock.
- Confirmed: `health.ts` takes `notReady()` only. Poll failures are not tracked there.
- Confirmed: `api.ts` calls `res.json()` with no cap.
- Correction: the SMTP config type already has `clientName` ("Name sent with EHLO"), and the default is `"localhost"` (`smtp.ts` ~262). The work may only be a default of `os.hostname()` and, if missing, an env or config key. The plan must check whether `clientName` is reachable from channel config.
- Reminder burst: `detector.ts` emits the latest due reminder for each open incident whose reminder key is not handled. On a channel whose reminders were just enabled, each older open incident gets one reminder (not one per interval) on the next poll.

## Open points (none blocks the spec)
1. **Resend interface.** The plan must choose between a CLI subcommand (the ledger is file-based and the service is stopped, so no auth is needed, and it fits the lock file) and an authenticated endpoint (needs a new secret and a listener that today is unauthenticated). Assumption: the CLI subcommand, because the health listener is unauthenticated by design and the lock file gives a safe offline path. The CLI must refuse to run, with exit 2, while the lock is held.
2. **Resend semantics.** A failed event needs its payload to be resent, but `settle` deletes the payload. The plan must keep payloads for `failed` (up to retention) or rebuild the event from the API. Assumption: keep the payload for `failed` entries. The ledger format needs a version or compatibility rule for existing files. Resend sets the status back to `pending` with the same key and the service delivers it at the next start. Define what `resend` does for a stale reminder (the incident resolved since) and for a `failed` entry with no stored payload (list it, refuse to resend, exit non-zero).
3. **Permanent error classification.** The channels throw their own errors. A shared typed error (e.g. `PermanentDeliveryError`) with the HTTP status or SMTP code must be defined. Rules: HTTP 4xx except 408 and 429 and SMTP 5xx are permanent. Open: SMTP 5xx during connect or greeting (e.g. 554 refusal) and 5xx on AUTH are also treated as permanent; 4xx SMTP stays retryable. Redirects (3xx) stay retryable or fail as today. Assumption: classification is by the final response status. The per-event deadline is optional; assumption: not added, because the permanent classification plus the retry cap bound the block. With `PULSE_NOTIFY_RETRY_ATTEMPTS=0` (retry forever) a retryable dead receiver still blocks forever. The "never blocks longer than its retry schedule" line is only true for a finite limit. Decision for the plan: document it, or add a deadline.
4. **Healthz threshold N.** The plan picks a default (e.g. 5 consecutive failed polls) and an env override, documented. A successful poll resets the count. "Failed poll" means the API call or the detection step threw. Interaction with the startup state (no poll yet = ready as today?) must be defined. Metrics may expose the count.
5. **Ledger retention.** Pick the default (e.g. 30 days) and an env name. This needs timestamps per entry, but the ledger stores a bare status string. The format change needs a migration of old files (existing entries get the load time as their age). Pruning opened/resolved keys must not cause a resend: a pruned key of a still-open incident would look unhandled. The plan must prune only keys of incidents that are gone from the API or older than retention and also resolved, and say how this interacts with the API's own incident retention.
6. **Batched or asynchronous writes.** The at-least-once guarantee requires `claim` to be durable before the first send. `settle` may be batched (a lost settle only causes a resend after a crash, which is acceptable at-least-once). The plan must state which calls stay synchronous-durable and how the batch flushes on shutdown.
7. **Lock file.** Use an exclusive create (`wx`) of `<ledger>.lock` with the pid. A stale lock after a crash or kill -9 must be recoverable: check whether the pid is alive, or document manual removal. In Docker the pid is usually the same number after a restart, so a pid check alone gives false "alive". The plan must handle this. Error text is clear and exit code is 2. Check whether 2 is already used for config errors in `index.ts`.
8. **Reminder burst.** Assumption: when a channel has no reminder history, seed the due reminder key of each open incident at first start with reminders (like `seedKeys` already does for a new channel), or only send reminders for incidents that were open when the plan was enabled once their next interval is due. The plan chooses and documents it. It must detect "reminders newly enabled" without new config state, e.g. no `*:reminder:*` key and no record of the reminder setting. Conflict to settle: a channel that never had a reminder fired and legitimately has an old incident cannot be told apart from a newly enabled one.
9. **SMTP timeout over a whole attempt.** Make the existing per-command guard share one deadline (`timeoutMs` for connect through QUIT). Check that `PULSE_NOTIFY_TIMEOUT_MS` semantics stay the same for HTTP channels.
10. **SMTP reply cap.** Set limits for lines per reply and total bytes across `#partial` and queued `#replies`. A bad server fails the attempt with a retryable error (not permanent).
11. **API body cap and URL redaction.** Choose a cap (e.g. 5 MiB, env override) and read the body as a stream, since `Content-Length` can be missing or false. Over the cap fails the poll. Redact userinfo (and query strings if they could carry tokens) in every log line that prints `apiUrl`, including error messages from `fetch`.
12. **Docs.** `README.md` and `docs/` of notify list env variables, health semantics, the CLI and the ledger format. Every new env variable is documented there.

## Assumptions
- No contract change. The wire types are untouched, and no message format or routing changes (non-goal).
- The index entry point supports subcommands (`node src/index.ts failed ...`) without starting the service. Tests run with `node:test` and inject fake clocks and fake fs where possible.
- Each behavior change gets a test that fails on the old code (permanent 404/410/550 = one attempt; STARTTLS injection; oversized reply; ledger prune; lock; healthz after N failures; reminder burst; body cap; URL redaction; EHLO default; whole-attempt timeout).

## Derived acceptance check
Run the notifier against test receivers and a temp ledger:
1. A receiver that answers 404/410 (or SMTP 550) settles the event as `failed` after one attempt with a "permanent" log, and the next event of the same channel is delivered at once. A 500, 408, 429 or a timeout is still retried.
2. With the service stopped, `failed list` shows the failed event, and `failed resend <key>` (or `--all`) makes the next start deliver it under the same key exactly once more.
3. After N consecutive failed polls `/healthz` returns 503, and one good poll returns it to 200.
4. A reply injected before STARTTLS is not read after the handshake. An oversized multi-line reply fails the attempt.
5. Entries older than the retention are gone after a prune. A crash after a delivered send never loses a pending claim. A second instance on the same ledger exits 2 with a clear message.
6. Enabling `remindEverySeconds` on a channel with old open incidents sends no reminder burst at the first poll.
7. EHLO carries the host name by default or the configured name. One SMTP attempt cannot exceed `PULSE_NOTIFY_TIMEOUT_MS`.
8. An oversized API response fails the poll. The startup log of `https://user:pw@host` shows no `user:pw`.
9. `npm run check` passes in notify, and the docs describe every item above.
