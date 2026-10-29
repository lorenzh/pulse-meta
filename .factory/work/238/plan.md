# Spec: heartbeat checks for cron jobs and workers (#238)

Tracking: #166 (F1). Inputs: `issue-review.md` in this directory (its assumptions are decided below).

## Goal

A new check type `heartbeat`. A job pings pulse (`curl` from cron). When no ping arrives within `period + grace`, the check is `down` and an incident opens through the existing incident path. The next ping resolves it.

## Scope and non-goals

In scope: contract type and validator; api config, ping endpoint, evaluator, metrics, e2e; probe skips the type; status renders it; notify verified; docs in each changed repo.
Non-goals: start/finish pings, job duration, cron expressions (fixed period only), rate limiting, per-ping bodies.

## Decisions (the review's open points)

1. **Wire shape.** `HeartbeatCheck { id, name, type: "heartbeat", period: number, grace: number }`, ms, both integers. `period` 1000..86400000 (required). `grace` 0..86400000, optional in the checks file, default 0, always set in served data (like `port` of `TlsCheck`). No `url`, `host`, `intervalMs`, `timeoutMs`, `keyword`. The secret is NOT part of the contract type (never served).
2. **Auth.** A per-check `secret` in the api checks file: string, 16..128 chars, characters `A-Za-z0-9._~-` only (URL safe), required for heartbeat checks, rejected on other types (unknown key). It is a different credential from probe tokens: probe tokens cannot ping, the secret cannot call `/results`. The api keeps only the secret in memory (from the config; never in SQLite, never in `GET /checks`, `/metrics`, incident reasons or errors) and compares a SHA-256 digest with `crypto.timingSafeEqual`.
3. **Ping endpoint.** `POST|GET /heartbeat/<id>` with `Authorization: Bearer <secret>` (preferred), or `POST|GET /heartbeat/<id>/<secret>` (for plain `curl` in cron). No query-string form. Other methods: 405. Any request body is read up to 1 KB and ignored (over that: 413). Success: `204`, no body. Unknown id, wrong or missing secret: the same `401 {"error":"unauthorized"}` with `www-authenticate: Bearer` (existence of an id is not revealed). Ping to an `inactive` check: `204`, nothing recorded (monitoring is off, jobs keep working). `id` is URL-decoded as for `/checks/:id/results`.
4. **Keeping the secret out of logs.** The api has no per-request access log and must not add one that prints the path. The metrics route label for the path form is `/heartbeat/:id` (never the id or secret; `routeOf` in `server.ts` maps `/heartbeat/...` to it). `logError` messages must not include `req.url`. Docs: prefer the header form; the path form puts the secret in the URL, so reverse proxies, cron mail and shell history can log it; give guidance to redact `/heartbeat/*/` in proxy logs, rotate by editing the file (reload) and use `curl -fsS` without `-v`.
5. **A ping** records an `up` result: `statusCode` null, `latencyMs` 0, `reason` null, `location` `heartbeat`, `attempts` 1, `timestamp` = api `now()`, through the same ingest path as a probe result (so `lastResultAt`, uptime and incident resolve work). `lastResultAt` is the "last ping" time. Quorum does not apply (one source): the heartbeat result decides state directly. Late-result logic does not apply (the api sets the timestamp itself).
6. **Evaluator.** A timer in the api (tick every `min(1000, period/2)` ms or a fixed 1 s tick) checks every active heartbeat check. A check is overdue when `now - max(lastPing, startedAt) > period + grace`, where `startedAt` is the later of api process start and the time the check was first seen or its `period`/`grace` last changed (in-memory, reset on reload when those fields change). This gives: before the first ping the state is `unknown` until period+grace has elapsed, then `down`; after an api restart the persisted last ping is used but the downtime of the api itself never opens an incident (grace counts from start). When overdue and the check is not already down, the evaluator writes ONE `down` result (`statusCode` null, `latencyMs` 0, `location` `heartbeat`, `reason` `no ping within <period+grace>ms`) through the incident path, which opens an incident. It writes no further results during the same outage. The metric counts one missed period per elapsed `period` after the deadline (see 8). The next ping writes `up`, which resolves the incident.
7. **Maintenance and inactive.** Inside a maintenance window, pings are recorded as for other types and the evaluator writes no `down` result (as for other types, state is `maintenance`; check how `service.ts` handles windows and reuse it). `inactive` checks are not evaluated. A removed check is dropped from the evaluator on reload. Changing `period`/`grace`/`secret` on reload keeps the last ping.
8. **Metrics.** `pulse_heartbeat_pings_total{check}` (accepted pings) and `pulse_heartbeat_missed_total{check}` (missed periods), same label style and HELP/TYPE lines as the existing counters in `metrics.ts`. Failed-auth pings are not counted per check (no label from untrusted input); they appear in the existing request counter under `/heartbeat/:id` with status 401.
9. **Docs.** Each changed repo documents its part. The api docs include this example: `*/5 * * * * curl -fsS -m 10 --retry 3 -H "Authorization: Bearer $PULSE_HB_SECRET" https://pulse.example.com/heartbeat/nightly-backup >/dev/null`, and the path form.
10. **Versioning and order.** Adding a union member is a minor contract change. Downstream repos pin the contract by commit SHA, so `api`, `probe`, `status`, `notify` come after `contract`. `probe` and `status` do not depend on `api` (they only handle the type); `notify` is verify-only.

## Risks

- Older probe/status that do not know `heartbeat` would run it as HTTP: deploy contract, then api last for production, but the probe change must land before heartbeat checks are configured (documented).
- Secret in URL can leak through proxies (documented, header form preferred).
- Timer drift or a stalled event loop could produce a late `down`; the next ping heals it.

## Acceptance evidence (end to end)

With the `compose-e2e` stack and a heartbeat check `period=2000, grace=1000`, no pings: within about 5 s `GET /checks` shows `down` and the secret is absent, `/incidents?status=open` has one incident, `/metrics` shows `pulse_heartbeat_missed_total` > 0 (and `pulse_heartbeat_pings_total` 0); the status page shows "no ping yet"/"last ping" and no secret, also with hide-details on; `notify` delivers the incident. `curl` with the header or path secret returns 204, the check becomes `up`, the incident resolves, the ping counter increases. Wrong secret or unknown id: 401, nothing recorded. The probe token gets 401 on the ping and the ping secret gets 401 on `/results`. Probe logs no line per reload for the heartbeat check. Every new test fails on the old code.

## Repository: contract

Files: `src/index.ts`, `src/validate.ts`, `docs/index.md`, `test/validate.test.ts`, `test/types.fixture.ts`, `README.md` if it lists the types, version file only if the contract rules for a minor bump require it (see `src/version.ts` and its test; the wire version number must stay unchanged unless that file says otherwise).

- Add `HeartbeatCheck` (decision 1) with doc comments, add it to `Check`; `CheckWithState` follows by distribution.
- Validator: `validateCheck` accepts `type: "heartbeat"` with `period` integer and `grace` integer (both within the bounds above), rejects unknown keys and any of `url`, `host`, `intervalMs`, and a `secret` key (the secret never travels); the error text for an unknown type becomes `must be "http", "tls" or "heartbeat"`. Make sure `validateCheck` on arrays (the `GET /checks` response validator) accepts it too.
- Docs: describe the type, the state fields (`lastResultAt` = last ping), and that the probe never runs it.
- Tests (fail on old code): valid heartbeat; missing period; non-integer / out-of-range period and grace; extra key; wrong-type fields; fixture compiles with narrowing on `type`.
- Done when: `npm run check`-equivalent (see the repo AGENTS.md) passes and `dist` is built as the repo requires. A commit on `main` is the pin for the other repos.

## Repository: api

Files: `src/config.ts` (parse `heartbeat`: keys `id,name,type,period,grace,secret`; `secret` rules of decision 2; error messages `checks[i].period must be ...`), `src/db.ts` + `src/service.ts` (nullable `period_ms`, `grace_ms` columns added by migration in the style of existing `ALTER TABLE` handling; row mapping to `HeartbeatCheck`; secret kept in memory only; ingest of ping results; evaluator tick; `intervalMs`-dependent code such as the quorum window, retention and late logic must skip or special-case heartbeat), `src/state.ts` if needed, `src/server.ts` (route `/heartbeat/<id>[/<secret>]`, `routeOf`, `known` paths, auth, 204/401/405/413), `src/metrics.ts`, `src/start.ts` (start/stop the evaluator timer with the server; clear on shutdown), `checks.example.json`, `compose/checks.json`, `scripts/compose-e2e.sh`, `docs/` (`configuration.md`, `rest-api.md`, `concepts.md`, `operation.md` incl. cron example and secret handling, `troubleshooting.md`, `development.md` for the e2e), `README.md`.

- Config: reload (the existing checks-file reload path) applies decision 7; a heartbeat check without `secret`, with a probe-only key (`url`, `intervalMs`, `timeoutMs`, `keyword`, `retries`...) or an invalid value is a `ConfigError`; duplicate ids stay rejected.
- `GET /checks` serves `{id,name,type:"heartbeat",period,grace,...state}` and never the secret (test with a deep search of the JSON for the secret string). `/results` for a heartbeat check from a probe token: keep accepting only what the existing validation allows, but add a test that the ping secret is not a probe token.
- Evaluator takes `now()` and a timer interface so tests use a fake clock (no sleeps); test the cases of decision 6 and 7 (before the first ping, after restart with persisted ping, repeated ticks write one down result, resolve on ping, maintenance, inactive, reload keeps last ping, quorum bypass with other locations absent).
- Server tests: GET and POST, header and path form, 405, 401 for wrong/missing/unknown (identical bodies), 204 for inactive without a stored result, body limit, a probe token cannot ping, the ping secret cannot post `/results`, metrics counters and labels without secret or id in the route label, the secret absent from every log line and error body.
- `compose/checks.json` gets a heartbeat check `heartbeat-e2e` (period 2000, grace 1000, a throwaway documented secret). `compose-e2e.sh` adds steps: the check goes down without a ping and an incident opens, and `/metrics` shows missed periods; then `curl` with the secret resolves it and the incident closes; wrong secret gives 401; the secret is absent from `GET /checks`; the status page shows the check. Keep the existing steps and their timeouts working (the other incident steps must not be confused by the new check: filter by check id).
- Depends on `contract` (bump the pinned SHA and `package-lock.json`).
- Done when: the repo checks and unit tests pass, the new tests fail on the old code, and `scripts/compose-e2e.sh` passes where Docker is available (CI runs it).

## Repository: probe

Files: `src/client.ts` (`toCheck` and the wire parse), `src/check.ts` if it dispatches on type, `src/scheduler.ts`/`reloader.ts` as needed, `docs/`, `README.md`, tests next to them.

- The check list fetched from `GET /checks` is filtered: `type: "heartbeat"` entries are dropped before scheduling; they must not be run as HTTP, must not throw, must not appear in "unknown type" or "checks loaded" diffs, and the reload loop logs no line for them (a reload where only heartbeat checks changed logs nothing extra). An unknown future type is skipped the same way if the contract validator allows it to reach the probe; do not crash.
- Tests (fail on old code): a list with http, tls, heartbeat gives a scheduler with two checks and no request to any URL for the heartbeat; no log line per reload (assert the logger got no call mentioning the id); the count in existing log lines excludes heartbeat.
- Docs: state the probe never runs heartbeat checks.
- Depends on `contract` (pin bump).
- Done when: repo checks and tests pass.

## Repository: status

Files: `src/api-filter.ts`, `src/poller.ts` (line ~93 types normalisation), `src/render.ts` (`targetText`, extra detail for TLS/keyword branches), `public/` strings or CSS if needed, `docs/`, `README.md`, tests (`render.test.ts`, `server.privacy.test.ts`, `poller.test.ts`).

- Render heartbeat checks with no target line; show `last ping <time>` in the same time format the page uses for other times (from `lastResultAt`), or `no ping yet` when `lastResultAt` is null. No `url`, `host` or secret anywhere (the api never serves a secret; the filter must also drop any `secret` key defensively).
- Hide-details setting: behaves as for other types (no target is shown anyway); `last ping` is a state detail and follows the same rule as the other last-result times; period and grace are hidden when hide-details is on. State the rule in docs and test both settings.
- `check.url ?? ""` paths must not render the string `undefined`; HTML is escaped.
- Tests (fail on old code): heartbeat card for up, down, unknown, maintenance; with and without hide-details; the proxy `/api/checks` output for a heartbeat check has no secret/url/host key.
- Depends on `contract` (pin bump).
- Done when: repo checks and tests pass.

## Repository: notify

Verify-only plus a regression test: `src/notifier.ts` and its payload build must work for an incident of a check without `url`/`host`/`intervalMs`.

- Add a test in `test/notifier.test.ts` that an incident for a `heartbeat` check (fixture from `GET /checks`) is delivered to a webhook/file channel with the check name, id and reason and no crash. Make code changes only if that test shows a failure.
- Docs: one line in `docs/index.md` or `docs/channels.md` that heartbeat incidents are delivered like others.
- Depends on `contract` (pin bump so the fixture type-checks).
- Done when: repo checks and tests pass.
