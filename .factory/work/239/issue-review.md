# Issue review: #239 Slack, Teams and email channels with reminders and signed webhooks

Only `notify` is affected. No question blocks the spec.

## Current behavior (checked in `.repos/notify`, `.repos/contract`)

- Channel types: `webhook` (`url`, http/https) and `file` (`path`). `src/config.ts` rejects unknown keys per channel. Common keys: `id`, `type`, `checks` (check ids, empty means all).
- Senders live in `src/channels/`, are chosen with a ternary in the `Notifier` constructor in `src/notifier.ts`, and have the type `Sender = (Notification, signal) => Promise<void>`.
- `Notification` has `key`, `event` (`opened|resolved`), `incidentId`, `checkId`, `checkName`, `reason`, `time`, `timeMs`. The key is `<incidentId>:<event>`.
- `detector.ts` derives events from the incident list only. The `ledger.ts` file stores one status per channel and key, and the pending payloads. `ChannelDelivery` retries with backoff, and a send is "delivered" when it does not throw.
- `Check` in the contract has no tags and no status page URL. The `Incident` has no state history.
- The webhook sender uses `redirect: "manual"` and a timeout via `fetchWithTimeout`. It has no signing. The body is `JSON.stringify(notification)`.
- There are no runtime dependencies besides the contract.

## Open points (the plan decides; recommendation in brackets)

1. **Tags.** The contract `Check` has no tags, so tag routing would need a contract change. The non-goal says no contract change unless necessary. [Ids only, plus a glob pattern on the check id (`*` wildcard) and `excludeChecks`. Document that tags are not supported. Keep `checks` as it is.]
2. **Include/exclude semantics.** Define the precedence: `checks` (existing, exact ids) is an include list. New `exclude` wins over include. Patterns versus exact ids must not break existing exact ids. Unknown keys stay rejected.
3. **Status page link.** No setting exists. [Add an optional env var such as `PULSE_STATUS_URL`, or a per-channel `statusUrl`. The link is the base URL as a whole, because no per-check anchor is known in this repo. Check `.repos/status` for any per-check URL scheme before claiming one.] Message text must omit the link when it is not configured.
4. **Reminders.**
   - The event type is a new `reminder` (the `NotificationEvent` union grows). The webhook and file payloads then gain a new `event` value. Existing receivers may see an unknown event only if the operator enables `reminderMinutes`, so this is opt-in. Document it.
   - Idempotency key: `<incidentId>:reminder:<n>`, with n counted from the incident `openedAt` and the interval (`floor((now - openedAt) / interval)`). This stays stable across restarts. The key is derived, so there is no extra state beyond the ledger.
   - Catch-up: after an outage or a restart, send at most one reminder (the latest n), not one per missed interval. Seeding must not fire reminders for pre-existing open incidents on a new channel. The first run only seeds. Reminders for a seeded open incident then start from the next interval; decide this explicitly.
   - Stop conditions: no reminder once the incident is resolved. A reminder still queued or retrying when the incident resolves should be dropped, or sent before `resolved`. Per-channel FIFO ordering must keep `resolved` after `opened`.
   - Interval unit and bounds: [`remindEverySeconds` or minutes, minimum 60 s, integer]. It must be at least the poll interval.
   - The `detector` needs `now` (injected, no real clock). `ledger.has` for reminder keys grows unbounded. Consider pruning or keeping only the latest n per incident.
   - The channel `checks` filter applies to reminders too. Only the channels that opted in get them.
5. **Message content.** "Respecting a per-channel option to hide reasons": [`hideReason: true`]. Does it also apply to webhook and file channels? [Chat and email only; the webhook payload stays unchanged, so existing configs keep working.] Escape or limit reason text (untrusted check output: Slack mrkdwn, `<`, `&`, mentions like `<!channel>`, Teams markdown, email header injection in the subject). Truncate to a maximum length. "Time" is `time` (opened/resolved); for a reminder, show how long the incident has been open.
6. **Slack/Teams payloads.** Slack: `{"text": ...}` with mrkdwn. Teams: incoming webhook (MessageCard, being retired) versus Workflows URL (Adaptive Card attachment in a message). [Decide one payload that works for the Workflows URL, which is what current Teams offers, and document it. Optionally a `format` option.] Success is a 2xx. Slack returns 200 `ok`; some Teams Workflow URLs answer 202. Keep `redirect: "manual"`. Treat 429 and 5xx as ordinary failures with the existing retry. Honoring `Retry-After` is out of scope unless the plan wants it.
7. **Webhook URLs are secrets.** The Slack/Teams URL is a credential. The spec says "credentials only from env or files referenced by the config". Define the config keys: [`urlEnv`/`urlFile`, or `url` with `${ENV}` expansion]. Decide whether the inline `url` is still allowed for slack/teams (the webhook `url` is inline today and must keep working). Never log URLs. Error text from `fetch` can contain the URL, so errors need sanitizing. `errorFields` must be checked. Metrics and logs name channel ids only.
8. **Email.**
   - Dependency. Node has no SMTP client. Options: a small hand-written SMTP client on `node:net` / `node:tls` (EHLO, STARTTLS, AUTH PLAIN/LOGIN, MAIL FROM, RCPT TO, DATA with dot-stuffing, QUIT) versus `nodemailer` (zero-dependency, maintained, but large). The repo has no runtime dependency besides the contract, and the build runs unbuilt under type stripping. [Recommend the own minimal client (about 150 lines) unless the plan justifies nodemailer. Name the supported subset.] A new dependency would need a lockfile change and a Dockerfile check.
   - Config: `smtp: { host, port, tls: "none" | "starttls" | "tls", username?, passwordEnv|passwordFile }`, `from`, `to` (array), optional `subject` prefix. The `tls` default must be safe: [`starttls` required, a plain connection only with an explicit `none`]. Certificate verification stays on.
   - Idempotency for email: a message that was accepted but whose reply was lost is sent twice (at-least-once). Set `Message-ID` from the notification key so a receiver can deduplicate.
   - Timeouts on connect and on every command, using the existing timeout and abort signal. Transient (4xx) versus permanent (5xx) reply codes: [both retry as for webhooks; permanent errors are logged, not treated differently].
   - Header injection: reject CR/LF in `from`, `to`, and in the subject/reason.
9. **Webhook signing.**
   - Config: `secretEnv` / `secretFile` (not an inline secret). Name them consistently with item 7.
   - Signature input: "HMAC of the raw body" only. A replayable timestamp not covered by the signature weakens the scheme. Decide: [keep the spec form (`sha256=<hex HMAC of body>`) as required, and also sign `<timestamp>.<body>`? These two are different]. The spec text says body only; the plan must pick one and give a verification snippet that matches. If the timestamp is not in the MAC, say in the docs that the timestamp is advisory and replay protection is the `Idempotency-Key`. [Recommend body only as specified, documented limit.]
   - `X-Pulse-Timestamp`: unit (Unix seconds or ms) and that it is taken at send time per attempt (injected `now`), whereas the body is stable across retries.
   - Does signing apply to slack/teams? No (the receiver is a third party).
   - Also applies to reminders.
10. **Plain `http:` URLs.** [Warn once at startup for `http:` webhook URLs, and reject `http:` for a signed webhook unless `allowInsecure: true`? The simplest that keeps existing configs working is a startup warning. A signed webhook over plain http leaks nothing secret, since only the HMAC travels, so warn.] For slack/teams require `https:` (reject otherwise). Warning goes through the injected logger and names channel ids only. Loopback URLs (`127.0.0.1`) are exempt, which the tests need.
11. **Existing behavior must not change.** Existing webhook and file config files parse as before. A webhook body without a secret has no new headers. The pending-key resend after restart, ledger format (`version: 1`), and legacy rebuild must keep working. Reminder pending payloads in the ledger rely on `Notification` with the new event. `#findEvent` splits the key on `:` and accepts only opened/resolved. It must handle reminder keys, or be left alone because reminders always carry a payload.
12. **Docs.** Doc structure today: `docs/channels.md`, `configuration.md`, `operation.md`, `troubleshooting.md`, `index.md`, `README.md`. The request says one page per channel type. [`docs/channels/slack.md`, `teams.md`, `email.md`, `webhook.md` (with signing and the verification snippet), `file.md`, linked from `channels.md` and the docs index.] Each with a config example and a text sample message. `README.md` must list the new settings. `troubleshooting.md` gets the new failures.
13. **Metrics.** `/metrics` names channel ids only (already so). Check whether the metrics need a new label value for reminders; [no new metric, reminders count as deliveries].
14. **Tests** (in `test/`, not next to code; hand-written fakes; `127.0.0.1` port 0): fake Slack/Teams HTTP server, local SMTP stub (plain and STARTTLS or TLS with a test certificate, or plain only if the plan documents the gap), signature verification against the fake server, reminder with an injected clock, restart idempotency, failure + retry for each new type, config rejection (unknown key, `http:` slack, missing secret file). They must fail on the old code. `npm test` needs 80 % line coverage, and cognitive complexity per function is limited to 15, so `config.ts` `parseChannel` needs a split per type.
15. **Config file credentials.** Secrets referenced by file: read at startup (fail fast with a `ConfigError` naming the channel id and not the value), trim a trailing newline. Reload on change is out of scope.

## Assumptions

- No contract change. Tags are not available, so routing is by check id (exact and pattern) and an exclude list.
- The status page link is operator-configured; this repo does not discover it.
- Only `notify` gets a child issue; `targets.json` lists `notify` alone, and no `dependsOn`. Check whether `config` (shared tooling) or `status` needs anything: no.
- Reminders are opt-in per channel; the default behavior is unchanged.
- Hiding the reason affects the chat and email messages only.
- Retry, backoff, and ledger semantics for the new channels are the same as for webhooks.

## Derived acceptance check

With `PULSE_NOTIFY_CONFIG` containing a `slack`, a `teams`, an `email` and a signed `webhook` channel (plus the old `webhook` and `file` ones unchanged), and a fake API with one check that goes down:

1. Each new channel receives one "opened" message with check name, state, reason (absent when `hideReason` is set), time, and the status link when configured. The Slack, Teams and SMTP fakes verify the payloads.
2. After the incident stays open for the reminder interval, a reminder with its own key arrives once per interval; after a restart no reminder is duplicated for the same interval; after resolution no reminder follows and a "resolved" message is sent.
3. A routed-out check (not in `checks` or matched by `exclude`) produces no message on that channel.
4. The signed webhook carries `X-Pulse-Signature: sha256=<hex>` and `X-Pulse-Timestamp`. Recomputing the HMAC with the secret over the raw body matches. A channel without a secret has neither header.
5. A failing receiver (HTTP 500 or an SMTP 4xx) is retried with backoff and ends `delivered` or `failed` in the ledger as for webhooks; no secret, URL or password appears in logs or `/metrics`.
6. Unknown keys, an `http:` URL on slack/teams, and a missing secret are rejected at startup; `http:` on a webhook warns. The old webhook and file configs start unchanged.
7. `npm run check` passes in `notify`; one docs page per channel type exists with a config example and a sample message.
