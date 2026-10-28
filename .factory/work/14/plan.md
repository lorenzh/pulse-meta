# Spec: Incident notifications (#14)

## Goal

The people responsible for a service learn about an incident without watching the status page. When an incident opens or resolves, pulse sends a notification (check name, reason, time) to configured channels: a generic JSON webhook and a JSON-lines file.

## Scope

- Implement the feature in `pulse-notify` (today an empty scaffold) as a long-running service of its own.
- notify polls `GET /incidents` (no `status` filter, so both open and resolved) and `GET /checks` on pulse-api. The api needs no change.
- Channel configuration, per-channel check filter, retry, a durable delivery ledger.

## Non-goals

- No change to pulse-api, pulse-probe, pulse-status. No api event feed, `since` parameter or push mechanism.
- No change to pulse-contract: notify defines its own config and notification types locally. Only `Incident` and `Check` are used from the contract (Git dependency pinned like probe/api).
- No webhook auth, signatures, custom headers; no email/chat channels; no notifications for history on first start; no redelivery of events that ended `failed`.

## Decisions (resolving the open points of the issue review)

1. **Delivery guarantee: at most once.** The ledger entry `(channelId, eventKey)` is written as `pending` (claimed) before the first send attempt, then `delivered` or `failed`. A claim is never re-sent. On startup every `pending` entry is logged as "possibly lost" (error level), so a crash loss is not silent.
2. **Failed events are never retried again**, also not after restart. The failure was logged. 4 attempts total (3 retries), default delay 1000 ms between attempts, configurable, injected `sleep`.
3. **Ordering**: per channel one FIFO queue and worker. `resolved` is sent after `opened`. If `opened` ended `failed`, `resolved` is still sent (independent events).
4. **First start / backlog**: if the ledger has no entry for a channel (new ledger, or a channel id seen for the first time), seed that channel with all currently visible incidents as handled (`opened`, and `resolved` for resolved ones) with status `seeded`; no notifications for history. Afterwards only new events are sent. Exception: an incident seen later whose id is not in the seed is new.
5. **Event detection**: per incident id, `resolvedAt == null` yields `opened`; `resolvedAt != null` yields `resolved`, plus `opened` first if its `opened` was never recorded for the channel (opened and resolved between two polls). Event key: `<incidentId>:opened|resolved`.
6. **Check filter** uses check ids. Channel `checks` absent or empty = all checks. Incidents of other checks are ignored for that channel. Unknown check ids in `checks` are allowed (checks may appear later).
7. **Notification body** (identical for webhook and file line):
   `{ "key": "<incidentId>:<event>", "event": "opened"|"resolved", "incidentId", "checkId", "checkName", "reason": string|null, "time": "<ISO 8601 UTC>", "timeMs": <epoch ms> }`.
   `time` is the event time: `openedAt` for opened, `resolvedAt` for resolved (not delivery time). `reason` is the incident's opening reason for both events. If the check name cannot be resolved, use the check id.
8. **Webhook**: `POST` with `content-type: application/json`, header `idempotency-key: <key>`, body above. 2xx = delivered. Non-2xx, network error, or timeout (default 5000 ms per attempt) = failure. Redirects not followed (`redirect: "manual"`, a 3xx is a failure).
9. **File**: appends `JSON.stringify(body) + "\n"` with `appendFile`; parent directory created if missing; errors go through the same retry/log path.
10. **Isolation**: poll loop only enqueues; each channel has its own queue and worker, so a slow or failing channel neither delays other channels nor the poll loop. A failing api poll is logged and retried on the next tick.
11. **Logging**: injectable logger writing structured JSON lines to stderr. A final failure logs level error with channel id, event key, attempts and last error.
12. **Shutdown**: `stop()` stops polling and workers without draining; unsent unclaimed events are re-detected on the next start (they are claimed only immediately before sending).

## Configuration

- `PULSE_NOTIFY_CONFIG`: path to a JSON file (required):
  `{ "channels": [ { "id": "ops-hook", "type": "webhook", "url": "https://...", "checks": ["example"] }, { "id": "log", "type": "file", "path": "./incidents.jsonl" } ] }`.
- Env: `PULSE_API_URL` (default `http://localhost:3000`), `PULSE_NOTIFY_STATE` (ledger file path, default `./notify-state.json` or SQLite via `node:sqlite`; implementer's choice, must be durable and written atomically/transactionally), `PULSE_NOTIFY_POLL_MS` (default 5000), `PULSE_NOTIFY_RETRY_DELAY_MS` (default 1000), `PULSE_NOTIFY_TIMEOUT_MS` (default 5000).
- Invalid config (not an object, empty/missing `channels`, duplicate id, unknown type, webhook without a valid http(s) `url`, file without `path`, `checks` not an array of strings) stops startup with a `ConfigError` and a clear message.

## Risks

- Crash between claim and send loses one notification (accepted by "at most once", surfaced by the startup log).
- `GET /incidents` has no pagination, so every poll reads all incidents; acceptable for now, interval configurable.
- Tests must not use real timers: inject clock, `sleep`, and a manual poll `tick()`.

## Acceptance evidence

All in pulse-notify tests with a fake pulse-api and a local webhook receiver (`node:http`) that can be switched off and on, a temp file channel, a temp ledger, injected clock/sleep:

1. Receiver off, open incident appears; first attempt(s) fail and are retried; receiver on within the retry budget: it gets exactly one `opened` request (check name, reason, time); the file has one line with the same content.
2. Incident resolves; same off/on sequence: receiver gets exactly one `resolved`; file has a second line. Total 2 requests and 2 lines, one of each event.
3. Restart (new instance, same ledger/config, same api data): no new requests, no new lines.
4. Permanently down channel: after 4 attempts an error is logged with channel and event key; the other channel is delivered without waiting (poll loop and healthy channel not delayed).
5. Channel filtered to another check receives nothing.
6. Invalid configs fail startup with clear errors.
7. First start with existing incidents sends nothing (seeded); a stale `pending` claim is logged at startup and not re-sent.
8. `npm run check` passes.

## Repository: notify

Files (all under `pulse-notify`):

- `package.json` / `package-lock.json`: add `@lorenzh/pulse-contract` Git dependency (same pinned commit as probe: `c78f73bc91e3d417a3da5693c81ba9db80fa1524`), scripts `start` (`node src/index.ts`).
- `src/config.ts` (parse and validate, `ConfigError`), `src/types.ts` (Notification, ChannelConfig), `src/api.ts` (fetch incidents and checks), `src/detector.ts` (events from incidents per decisions 4 and 5), `src/ledger.ts` (durable store, claim/deliver/fail/seed, list pending), `src/channels/webhook.ts`, `src/channels/file.ts`, `src/delivery.ts` (per-channel queue, retry with injected `sleep`, logging), `src/notifier.ts` (poll loop with injectable clock and `tick()`, `start`/`stop`), `src/log.ts`, `src/index.ts` (wire env, start, signal handling).
- Tests next to the code or in `test/` (`node:test`), covering every acceptance item above plus unit tests for config validation, detector, ledger persistence across instances, retry count and delays, and webhook status/timeout handling. Network tests use only local in-test servers.
- `README.md`: purpose, configuration and env table, notification payload, delivery guarantees (at most once, failed events logged and not retried, startup log of pending claims), how to run.

Behavior and checks: as in decisions 1 to 12 above. Completion evidence: `npm run check` passes; the acceptance tests 1 to 7 exist and pass.
