# Issue review: Incident notifications (#14)

## Current state (inspected in the clones)

- notify (`pulse-notify`): an empty scaffold. `src/index.ts` is one line, one smoke test, no dependencies beyond dev tooling. README says it is not yet wired to contract or api. Conventions (AGENTS.md): strict TS, ESM, Node 24 type stripping, `node:test` next to the code, injectable clock, no real timers in tests, network tests only against local in-test servers. `npm run check` = lint, typecheck, test.
- contract: has `Incident { id, checkId, openedAt, resolvedAt|null, reason|null }` and `IncidentsResponse`. No notification types. `dist/` is committed and must be rebuilt if types change. Types only.
- api: `GET /incidents?status=open|resolved` (open first, then newest first), no `since`/cursor/limit. `GET /checks` serves check names. Incidents live in the SQLite `incidents` table. The api has no push mechanism (no webhooks, events or streams). Incident logic is unchanged by this feature.
- probe, status: not involved.
- The meta `config.yaml` already lists `notify` as a build target (context: meta, contract, api).

## Assumptions

- The work lives in pulse-notify only. Contract gets at most small shared types (config/notification payload), optional. Api needs no change: notify polls `GET /incidents` (both statuses) and `GET /checks` (for check names, and for the check ids the channel filter covers). An api change (event feed, `since` parameter) is a possible optimisation and out of scope.
- Event detection: notify keeps its own state per incident id: "opened" seen / "resolved" seen. An incident with `resolvedAt == null` yields `opened`; one with `resolvedAt != null` yields `resolved` (and `opened` too if it was never delivered, e.g. it opened and resolved between two polls, so the pair is always complete and in order: opened before resolved).
- Notification content: event type (`opened`|`resolved`), incident id, check id, check name, reason (the incident's reason, null allowed), and time (ISO 8601 UTC string plus epoch ms: `openedAt` for opened, `resolvedAt` for resolved; the event's own time, not the delivery time).
- Webhook: HTTP POST, `content-type: application/json`, body is the notification object; 2xx = delivered, anything else, timeout or network error = failure. Request carries an idempotency key (event key `<incidentId>:<event>`) in the body and in a header, so receivers can deduplicate.
- File channel: appends one JSON line per notification (same object as the webhook body) with `\n`; file created if missing.
- Configuration: a JSON file (path via env, e.g. `PULSE_NOTIFY_CONFIG`) with `channels: [{ id, type: "webhook"|"file", url|path, checks?: string[] }]`; absent/empty `checks` means all checks. Plus env for api URL (`PULSE_API_URL`, default `http://localhost:3000`), state file path, poll interval. Invalid config stops startup with an error, like api's `ConfigError`.
- "At most once per channel, also after a restart": delivery state is persisted per (channel id, event key) in a durable store (SQLite via `node:sqlite` like api, or a JSON file written atomically). Recorded as delivered only after the channel confirms success. Strict exactly-once is impossible across a crash between send and record; the guarantee is therefore "at most once with a best-effort ledger": the ledger entry is written **before** the send ("claimed") for at-most-once, or **after** for at-least-once. The issue says at most once, so claim-before-send with a status (`pending`/`delivered`/`failed`) is assumed; see open point 1.
- Retry: a few = 3 retries (4 attempts total) with a fixed or growing delay (default 1000 ms, configurable, injected `sleep`). After the last failure: log an error line with channel, event key and error, and record the event as `failed` (not retried again in the same process lifetime; see open point 2). Never silent.
- Isolation: each channel has its own queue and worker, so a slow or failing channel does not delay other channels or the poll loop. Notify is its own long-running process (a separate service from api), which is what "run as a service of their own" means; it never blocks `POST /results` in the api.
- Tests: local `node:http` servers inside the test as webhook receiver and fake api; fake clock and injected sleep; temp dirs for files and ledger.

## Open points (non-blocking, spec should pick)

1. **At-most-once vs. loss on crash.** Claim-before-send means a crash between claim and send loses the notification; at-least-once duplicates it. The issue demands "at most once", but also "never lost silently". Recommended: claim-before-send, and on startup log every claim left in `pending` as "possibly lost" (so the loss is not silent). Spec must state it.
2. **Retry after "logged" failure and the restart scenario.** The done check turns the receiver off then on. With 4 attempts spaced ~1 s, a longer outage ends in `failed`. Is a failed event ever redelivered (on restart, or never)? Recommended: never, since it was logged and "at most once" holds; the acceptance test must keep the outage shorter than the retry budget (receiver down for the first attempt(s), back up within the retries), so retries produce exactly one delivery.
3. **Ordering.** `resolved` must not reach a channel before `opened`. If `opened` fails permanently, still send `resolved`? Recommended: yes, independent events, each retried on its own; per-channel queue keeps order while a retry is in flight.
4. **First start / backlog.** On a fresh ledger, existing open incidents and past resolved ones would all be notified. Recommended: on first start with an empty ledger, seed the ledger with the current incidents as already handled (no notifications for history) unless config says otherwise. Alternative: notify open ones only. Spec must pick; the acceptance test starts with no incidents.
5. **A new channel added later** gets only events seen from then on (ledger is per channel, but seeded the same way as point 4 when the channel first appears).
6. **Polling cost and latency.** `GET /incidents` has no pagination or `since`, so every poll reads all incidents. Fine for now; poll interval default (e.g. 5 s) configurable. An api change is deferred.
7. **Check filter** uses check ids (stable) rather than names; incidents of checks not in config are ignored per channel. Channels may overlap on checks.
8. **Webhook details**: timeout per attempt (default 5000 ms), no redirects followed, no auth/secret/signature headers (could be a later feature; custom static headers maybe). HTTPS allowed through `fetch`. Spec decides whether to include `headers` in the channel config; recommended not.
9. **File channel**: `appendFile` per notification, with its own queue so lines never interleave; path directory must exist or is created; failure (e.g. EACCES) goes through the same retry/log path.
10. **Time field**: the issue says "the time"; choose event time as above and document it. `reason` of a resolved event is the opening reason (incident has no resolve reason); the spec should say so.
11. **Maintenance/degraded**: unchanged; only incidents matter.
12. **Packaging**: notify needs the contract as a Git dependency (pinned commit like probe/api) for `Incident`. If contract adds types, merge order: contract, then notify (dependency bump). README for notify and the meta README repository table/run-all section get updated (a fifth terminal).
13. **Graceful shutdown**: `stop()` drains no queues; unsent events stay `pending`/unclaimed and are picked up on restart (they are only claimed right before sending).
14. **Logging**: plain structured lines to stderr via an injectable logger so tests can assert that a failure is logged.

## Derived acceptance check

Test inside pulse-notify, with a fake pulse-api (local http server serving `/incidents` and `/checks`), a local webhook receiver that can be switched off and on, a temp file channel, and an injected clock and sleep:

1. Config: one webhook channel (receiver URL) and one file channel, both covering check `example`. Start the notifier with an empty ledger.
2. Receiver off. The fake api now returns an open incident for `example`. The notifier polls; the first webhook attempt(s) fail and are retried; receiver switched on within the retry budget. The receiver gets exactly one request, JSON with `event: "opened"`, check name, reason and time. The file has exactly one line with the same content.
3. The fake api marks the incident resolved. Same procedure (receiver off then on): the receiver gets exactly one `resolved` notification, the file gets a second line. Total: receiver 2 requests, file 2 lines, one of each event.
4. Restart the notifier (new process/instance, same ledger and config) while the api still serves the same incident; no new requests at the receiver, no new file lines.
5. A channel that is permanently down: after the retries an error is logged with channel and event key; the other channel still gets its notification on time and the poll loop is not delayed (fake clock shows no wait on the healthy channel).
6. A channel limited to a different check receives nothing for `example`.
7. Invalid config (unknown channel type, missing url/path, duplicate channel id) stops startup with a clear error.
8. `npm run check` passes in pulse-notify.
