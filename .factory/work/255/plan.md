# Spec: Notify permanent errors, resend, ledger and SMTP hardening (#255)

Only `notify` changes. `contract`, `api`, `probe`, `status`, `config` need nothing: no wire type, message format or routing changes. Findings were verified against `notify` main (see `issue-review.md`).

## Goal
One dead receiver must not block a channel; failed events can be listed and resent; a stuck notifier shows as unhealthy; the SMTP client, the ledger and the API client are hardened.

## Non-goals
No change to channel message formats or routing. No per-event deadline (decision D2). No authenticated endpoint.

## Decisions
- **D1 Resend interface: CLI subcommand**, `node src/index.ts failed list` and `failed resend <key>|--all [--channel <id>]`. The ledger is a local file, the health listener is unauthenticated by design, and an endpoint would need a new secret. The CLI takes the ledger lock, so it refuses (exit 2) while the service runs. It needs only `PULSE_NOTIFY_STATE` (and the config file for channel ids only if `--channel` is validated; not required). It must not start the service, health listener or poller.
- **D2 No deadline.** With a finite `PULSE_NOTIFY_RETRY_ATTEMPTS` the block of a retryable error is bounded by the retry schedule; permanent errors end at once. With `0` (retry forever) a retryable dead receiver still blocks the channel; document this in `docs/` as the meaning of `0`.
- **D3 Reminders on enable:** seed, do not burst. See Ledger below.
- **D4 Payload kept for `failed`.** `settle(..., "failed")` keeps the notification so it can be resent.

## Required behavior (notify)

### Permanent errors
- New typed error `PermanentDeliveryError` (name set, `{cause}`, field `status`/`code`) in `src/errors.ts`.
- `http-post.ts` (Slack, Teams, webhook): status 4xx except 408 and 429 throws it. 3xx, 408, 429, 5xx, timeouts, network errors stay retryable.
- `smtp.ts`: a reply with code 5xx at any stage (greeting, EHLO, STARTTLS, AUTH, MAIL, RCPT, DATA, end of data) throws it; 4xx stays retryable. Classify by the final reply code.
- `delivery.ts#attempts`: a `PermanentDeliveryError` returns `failed` at once, with no sleep and no further attempt, even with `retryAttempts` 0. The log line "notification delivery failed" carries `permanent: true` and the text "permanent". Next queued event of the channel is sent immediately.

### Resend
- `failed list` prints one line per failed entry: channel, key, failure time, event, whether a payload exists. Exit 0 with no entries.
- `failed resend` sets the entry to `pending` with the same key and payload; the service sends it at the next start through the existing pending path. Idempotency key is unchanged.
- A failed entry without payload (written by an older version): listed as "no payload", resend refuses it, exit 1 (with `--all` it skips and reports, exit 1 if any skipped).
- A resent stale reminder is handled by the existing `isStale` drop at delivery.
- Unknown key: exit 1. Lock held: exit 2.

### `/healthz`
- `Notifier` counts consecutive failed polls (API fetch or detection threw; a poll that fetched fine but had rejected items is OK). A good poll resets to 0.
- New env `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS`, default `5`, minimum 1. When count >= N, `/healthz` returns 503 with `polls failing (<n> in a row)`. Before the first poll it stays "starting" as today. Expose `pulse_notify_consecutive_failed_polls` gauge in `/metrics`.
- `index.ts` composes `notReady` from shutdown, start and a `notifier.pollHealth()` accessor (add to `Stoppable` as optional so test fakes keep working).

### SMTP
- `upgrade()` (STARTTLS) clears `#buffer`, `#replies` and `#partial` (and any pending waiter state) before the TLS handshake.
- Caps: 100 lines per reply and 64 KiB total over `#partial` plus queued `#replies`; exceeding fails the attempt with a retryable error (not permanent).
- EHLO name: default `os.hostname()` (sanitised to a valid EHLO token, fall back to `localhost` when empty/invalid), override by optional channel key `smtp.clientName` (validated: host name or address literal, single line) parsed in `config.ts`, and env `PULSE_NOTIFY_SMTP_CLIENT_NAME` as global default. Pass `os.hostname` as an injected dependency (no direct call in pure code).
- The timeout covers one whole attempt (connect to QUIT): one shared deadline, each command waits for min(remaining). HTTP channels keep `PULSE_NOTIFY_TIMEOUT_MS` per request.

### Ledger (`src/ledger.ts`, format version 2)
- Entries get a timestamp (`at`, ms) and a status; v1 files load and migrate in memory, entries get the load time. Writes are always v2. A newer version than known is refused as today ("unsupported format").
- **Retention:** env `PULSE_NOTIFY_STATE_RETENTION_DAYS`, default `30`. At start and then once per hour, prune `delivered`, `dropped`, `failed`, `seeded` entries older than retention, with their payloads. Opened/resolved keys are pruned only when older than retention and the incident is no longer visible in the last successful poll (otherwise it would look unhandled and resend). Never prune `pending`. Document the interaction with the API's own incident retention (the API must keep incidents at least as long, or a pruned key of a still-listed incident would be resent: hence the visible-incident guard).
- **Durability:** `claim` and `seed` stay synchronous and fsynced (at-least-once needs a durable claim before the first send). `settle` and prune become batched: mutate memory, schedule one async write (temp + fsync + rename) coalescing calls within a short window (e.g. 100 ms), and add `flush(): Promise<void>` called on shutdown before exit and by `CLI`. A lost settle only causes a resend after a crash. Writes are serialised so a sync claim never races an async write (claim waits for/uses the same in-memory state and writes the whole current state). Avoid `structuredClone` of the full state per call: mutate in place, restore on a failed write only for sync paths.
- **Lock:** `<ledger>.lock` created with `wx` holding pid and start time. If it exists: read pid; if the pid is dead → stale, take over with a warning. If alive, or unreadable → error "state file <path> is in use by pid N (remove <path>.lock if no pulse-notify runs)" and exit 2 via `ConfigError`. Because in Docker the pid after restart is often the same number (and the container's own pid may be reused), the lock also stores a boot-unique random token and the hostname; a lock with another hostname, or a pid equal to `process.pid` of the new process, counts as stale (a new process cannot be the old owner). The lock is removed on clean shutdown. Exit code 2 already means startup/config error in `index.ts`.
- **Reminder burst:** ledger v2 stores per channel `remindersFrom` (ms). On the first poll, for a channel with `remindEverySeconds` and no `remindersFrom`, set it to now and seed the due reminder key of every open incident (like `seedKeys`), so no burst occurs; later incidents and later intervals remind normally. A channel without reminders drops `remindersFrom`, so re-enabling re-seeds. Known limit, documented: after upgrade from a v1 file, one due reminder per open incident is skipped once.

### API client
- `getArray` reads the body as a stream with a cap, env `PULSE_NOTIFY_API_MAX_BYTES`, default 5 MiB (5242880); a `Content-Length` over the cap fails early, and the stream stops past the cap even without or with a false length. Over cap fails the poll (counts as failed poll).
- New `redactUrl(url)` (userinfo → removed; query and fragment removed) used in the startup log and in every log/error that carries `apiUrl`, including `fetch` errors. `config.ts` errors about `PULSE_API_URL` must not echo userinfo.

### Docs
`README.md` and `docs/` (`configuration.md`, `operation.md`, `troubleshooting.md`, `channels/` email page): new env vars (`PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS`, `PULSE_NOTIFY_STATE_RETENTION_DAYS`, `PULSE_NOTIFY_API_MAX_BYTES`, `PULSE_NOTIFY_SMTP_CLIENT_NAME`), `smtp.clientName`, permanent-error rules, `failed list|resend` with examples and exit codes, health semantics and Docker healthcheck, lock file and stale recovery, ledger v2 and retention, reminder-enable behavior, retry `0` caveat. Update `AGENTS.md` only if a convention changes (new `failed` subcommand entry in "This repository").

## Repository: notify

Files: `src/errors.ts`, `src/channels/http-post.ts`, `src/channels/smtp.ts`, `src/channels/email.ts`, `src/delivery.ts`, `src/ledger.ts`, new `src/ledger-lock.ts`, new `src/failed-cli.ts` (pure: parse args, run on a Ledger, return lines and exit code), `src/index.ts` (subcommand dispatch before `main()`, lock, flush on shutdown, health composition, redacted log), `src/health.ts`, `src/metrics.ts`, `src/notifier.ts` (poll failure count, reminder seeding, prune hook), `src/api.ts`, new `src/redact.ts` (or in `errors.ts`), `src/config.ts`, `src/types.ts`, docs listed above.

Keep `npm run check` green: 80 % coverage, SonarJS complexity ≤ 15, no `any`, erasable syntax, `.ts` imports. Pass `now`, `fs`/pid-liveness, `hostname`, `sleep` as dependencies. Tests in `test/`, each written first and failing on old code:
1. 404, 410 (Slack, webhook) and SMTP 550 settle `failed` after one attempt, "permanent" logged, next event delivered immediately; 500, 408, 429, SMTP 451, timeout still retried; permanent also with `retryAttempts` 0.
2. `failed list` and `resend <key>`/`--all` on a temp ledger: entry back to pending, same key, delivered once on next start; no-payload refusal; unknown key; exit 2 when lock held.
3. `/healthz` 200 → 503 after N failed polls → 200 after one good poll; metric gauge; env parse and bounds.
4. STARTTLS: a reply injected before the handshake is not consumed after it (SMTP stub); oversized multi-line reply and too many lines fail retryably.
5. EHLO default is the injected hostname, config/env override, invalid name falls back; a stub that answers each command slowly stays under `timeoutMs` in total (fake schedule).
6. Ledger: v1 migration; prune by retention (and visible-incident guard); claim durable on disk before the sender runs (crash simulation reads the file); settle batched, `flush` writes; lock `wx` conflict exit 2, stale pid take-over, same-pid/other-host stale, lock removed on stop.
7. Enabling `remindEverySeconds` with old open incidents sends nothing at the first poll, then a new incident reminds normally; disabling and re-enabling re-seeds.
8. API body over the cap (with and without `Content-Length`) fails the poll; `redactUrl` of `https://user:pw@host/p?token=x` shows neither `user:pw` nor `token`, in startup log and fetch error log.
9. End-to-end per AGENTS.md: start the real service on port 0 against the fake API with a 404 receiver, then run the CLI, report the commands and results.

Completion evidence: `npm run check` passes; PR `Closes lorenzh/pulse-meta#<child>` lists the acceptance items 1-9 of the issue review with their tests and the known limits (retry `0`, v1 upgrade skips one reminder, lock staleness heuristics).

## Risks
- Async settle plus sync claim writing the same file: serialise all writes through one queue.
- Pruning too eagerly resends old events: guard by visible incidents and retention.
- Same-pid stale lock detection is heuristic; the error text tells how to remove it.

## Acceptance evidence
The derived acceptance check in `issue-review.md` (items 1-9) passes against test receivers and a temp ledger.
