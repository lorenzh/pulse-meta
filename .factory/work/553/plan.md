# Spec #553: notify liveness, manual-incident upgrade seeding, api reader hardening

## Goal
notify keeps running and stays quiet when the api feed misbehaves. It never resends manual incidents after an upgrade or after an edit of the update list. It treats the api answer as untrusted input. The Docker healthchecks of notify and probe use the port that `PULSE_HEALTH_PORT` sets.

The findings were re-checked on notify `c090a07` and probe `50ec9ca`. Both are the current `main` and match the issue (see `.factory/work/553/issue-review.md`):

1. **Liveness follows feed health.** `src/index.ts:236-249` passes the same `readiness` callback as `live` and `ready`. After `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` (default 5) failed polls, `/healthz` answers 503 and the image `HEALTHCHECK` marks a notifier unhealthy, even though its deliveries still work.
2. **Hard-coded healthcheck port.** notify `Dockerfile:19` and probe `Dockerfile:17` fetch `http://127.0.0.1:9100/healthz`, but the listener port comes from `PULSE_HEALTH_PORT` (`Dockerfile:10` / `:9`).
3. **Manual incidents are resent after an upgrade.** `src/notifier.ts:431-433` seeds only channels that the ledger does not know. A channel from before manual incidents gets every existing manual incident again. `src/detector.ts:101-103` and `:336-345` key updates by array index (`manual:<id>:update:<n>`), so an insertion into the update list skips the new update and resends a shifted one.
4. **api reader (audit notify 1-4).**
   - `src/notifier.ts:331` and `:408` call `String(id)` on an untrusted id. In Bun 1.4.0, `String({"toString":null,"valueOf":null})` throws `No default value` (verified locally), so the whole poll fails and stops every channel.
   - `src/api.ts:86-88` passes the `JSON.parse` message through. Bun 1.4.0 gives `JSON Parse error: Unexpected identifier "PULSE_MARKER_7f3a"` for the body `PULSE_MARKER_7f3a` (verified locally). Raw ids (`src/notifier.ts:411-414`), contract reasons and the received wire header (`src/api.ts:90`, contract `src/version.ts:26`) also reach the logs.
   - The contract client calls the injected fetch with only `signal` and `headers` (contract `src/client.ts:133-137`, identical at notify's pin `61f7bf8`). Bun follows redirects by default: a local test with origin A answering `302` to origin B got one request on B.
   - `#reported` (`src/notifier.ts:152`) keeps every rejected id and every check error text forever.

## Scope
- **notify:** liveness, the image healthcheck, manual seeding on first sight of the manual feed, stable update keys, the reader hardening, a skipped-item counter, a bounded warning cache, CI healthcheck checks, docs and an upgrade note.
- **probe:** the `Dockerfile` healthcheck, a CI step that checks it, and docs.
- **api:** `scripts/compose-e2e.sh` only. Today it matches the exact key `manual:<id>:update:1` (`scripts/compose-e2e.sh:497`, `:517-519`, `:527-529`). That key changes in notify, so the script must accept both forms before notify merges. No api source changes.

## Non-goals
- No delivery-queue, retry, SMTP or filter-change seeding changes. These belong to [#559](https://github.com/lorenzh/pulse-meta/issues/559) (delivery robustness), which also plans a different ledger write format. This spec adds one optional field (`manualFrom`) to the current version 2 format. Whichever change merges second carries the other's field. A conflict goes to the `merge` workflow.
- No contract, kit, config, status, console, website or deploy change. The contract validators keep their rules (for example the `at` order of manual updates).
- No stale-loop watchdog or freshness timeout for liveness.
- No change to the probe source, to its HTTP client or to notify's channel HTTP posts (`src/channels/http-post.ts`).
- No exactly-once delivery. "Never resends" covers detection and migration replay. Pending and failed entries keep their at-least-once behavior.
- No `PULSE_HEALTH_HOST` support in the healthcheck. It keeps fetching `127.0.0.1`. With `PULSE_HEALTH_PORT=0` (an ephemeral port), the healthcheck cannot know the port. This is documented, not fixed.

## Decisions on the open points of the issue review
1. **Liveness.** `/healthz` reports only the lifecycle. It answers 503 `starting` before the notifier started, 503 `shutting down` once a stop began (also after a lost state lock), and 200 otherwise. It never reads `consecutiveFailedPolls`. `/readyz` keeps today's callback unchanged: starting, shutting down, and `polls failing (<n> in a row)` at the threshold. `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` now applies only to `/readyz`. Its name and default (5) stay.
2. **What counts as seeing the manual feed.** Only a successful, validated array answer of `/manual-incidents` counts, including `[]`. A 404 (older api) and a failed read don't count. `#pollChannel` gets the whole `ManualIncidentsResult` (with `isAbsent`), not only its incidents.
3. **Durable marker.** The ledger gets a per-channel `manualFrom` (epoch ms), modeled on `remindersFrom` (`src/ledger.ts:39-40`, `:297-313`):
   - **Known channel, no `manualFrom`, first good manual read.** `ledger.seed` records the stable keys of every routed manual incident in the current answer (missing keys only, existing entries untouched) and sets `manualFrom = now` in the same synchronous write. That poll runs no manual detection for the channel. A write failure rolls both back, logs `ledger seed failed, the next poll retries` and skips manual detection for this poll. Automatic detection of the channel already ran before it and is not affected.
   - **New channel.** `#seedChannel` sets `manualFrom` in its write only when the manual read was not absent. On a 404 it seeds as today without the mark, so a later first good read seeds again.
   - **Once `manualFrom` is set,** manual detection runs as today.
   - **The marker survives** prune, flush, reload and an empty feed. It is never cleared.
   - **Ledger version stays 2.** The field is optional, so no version bump is needed. `migrate` reads `manualFrom` only for version 2 and keeps only entries whose value is a finite number. Any other value counts as absent: the next good read seeds again, which is quiet.
   - **`seed` signature.** It becomes `seed(channelId, keys, marks: { remindersFrom?: number; manualFrom?: number } = {})`. Both call sites (`src/notifier.ts:453`, `:523`) are updated.
4. **Upgrade tradeoff.** An old ledger cannot prove which manual updates were delivered. The first good manual read after the upgrade therefore records everything it shows as handled. That includes updates made while notify was down or between the upgrade and that read. This is written in the upgrade note.
5. **Stable update identity.** An update that is neither the creation (index 0) nor the resolving last update gets the key `manual:<id>:update:<d>`.
   - `<d>` is the first 32 lowercase hex characters of SHA-256 over the UTF-8 bytes of `JSON.stringify([update.at, update.status, update.message])`. Use `createHash` from `node:crypto`, a Bun built-in, so no new package is needed.
   - `manual:<id>:opened` and `manual:<id>:resolved` keep their form and meaning.
   - Legacy keys match `^manual:\d+:update:\d{1,9}$` and stable keys match `^manual:\d+:update:[0-9a-f]{32}$`. The two never overlap. `MANUAL_KEY` (`src/ledger.ts:92`) and `failed list` (`src/failed-cli.ts:19`) still parse both.
   - Two updates of one incident with the same `(at, status, message)` are one logical update and are sent once. Changing the message or the status makes a new update. This is a known limit, because the wire format has no update id.
   - `DetectedManualEvent.updateIndex` stays, so the notification payload is built from the current array.
6. **Legacy positional keys.** They are never rewritten or deleted by this change. The first-sight seeding (decision 3) also covers ledgers that already hold positional keys:
   - The stable keys of the current snapshot are seeded, so nothing replays.
   - A legacy `pending` or `failed` positional entry keeps its payload. It is resent by `#resendPending` or `failed resend` as today. Settled legacy keys age out through `prune`.
7. **Skipped items.** In `src/api.ts`, `RejectedIncident` becomes `{ index: number; id: number | undefined; reason: SkipReason }`.
   - `id` is set only when the raw `id` is a safe integer (`Number.isSafeInteger`). Nothing else is copied from a rejected item.
   - `SkipReason` is `"invalid" | "openedAt is not a valid date" | "resolvedAt is not a valid date" | "time is not a valid date"`. A contract validation error becomes `"invalid"`, and its text is dropped.
   - `onInvalidCheck` becomes `(index: number) => void`.
   - The notifier never calls `String` on a raw value.
   - Each rejected occurrence increments `pulse_notify_skipped_items_total{feed}` by 1, on every poll, whether or not its warning is suppressed.
   - Valid items of the same answer are used. A read with rejected items stays a good feed read and a good poll (unchanged).
8. **Body-free logs.** No log line or field carries text from an api response: no body, parser token, header value, `Location`, raw id or contract reason. `apiError` (`src/api.ts:74-96`) changes:
   - `invalid-json`: `GET <path> returned invalid JSON`.
   - `wire-mismatch`: `GET <path> wire version mismatch (expected <WIRE_VERSION>)`. `WIRE_VERSION` is the contract constant. The received header value is left out.
   - `validation`: `GET <path> did not return an array`, written directly instead of passing `error.message` through (today the text comes from `validateArray`).
   - `http`, `timeout`, `too-large` and `aborted` already use fixed text and stay.
   - `network` keeps the fetch error message with the api url redacted. That message comes from the runtime, not from the response.
   - Skip lines:
     - `incident skipped: malformed data` (error): fields `feed` (`incidents` or `manual-incidents`), `index`, `reason` (a `SkipReason`), and `incidentId` only when `id` is set.
     - `check skipped: malformed data` (warn): fields `feed: "checks"`, `index` and `reason: "invalid"`.
9. **Redirects.** None is followed for the three api reads, same-origin ones included. `getArray` wraps the fetch it passes to `fetchJson`: `(input, init) => base(input, { ...init, redirect: "manual" })`. `base` is `opts.fetch ?? fetch`, and `signal` and `headers` are kept.
   - In Bun 1.4.0 a `302` with `redirect: "manual"` comes back as status 302 with `ok === false`, and the target gets no request (verified locally). The contract client then reports `http` with status 302.
   - That is an ordinary feed failure: `api poll failed` with `GET <path> returned 302`, never the `Location` value. On `/manual-incidents` it is a failure too, not an absent feed. Only 404 stays tolerated.
   - Not following any redirect also rules out https to http. The docs say `PULSE_API_URL` must point at the final endpoint.
10. **Bounded warning cache.** A new module `src/bounded-set.ts` exports `class BoundedSet`:
    - `constructor(max: number)`, `add(key: string): boolean` (true when the key was new), `has(key: string): boolean` and `get size(): number`.
    - At capacity, adding a new key evicts the oldest inserted key (first in, first out, using a `Map` insertion order). `add` of a retained key returns false and does not refresh it.
    - The notifier keeps malformed-warning identities in `new BoundedSet(1024)`. The constant is `MALFORMED_REPORT_LIMIT = 1024` in `src/notifier.ts`.
    - An identity is `<feed>:id:<id>` when `id` is set, else `<feed>:index:<index>`. Checks always use the index form. So an identity has at most 64 characters: the feed name has at most 16, a safe integer at most 17 with its sign, and an index at most 7 digits within the 1 MiB default body limit.
    - The one-time missing-wire-header warning becomes a boolean field.
    - The legacy-rebuild keys (`src/notifier.ts:548-550`) move to their own `Set`. They come from the local ledger, not from the api.
    - `#reported` is removed.
    - Why 1,024: it is far above the item count of a normal feed, so a real bad item is not re-logged every poll. 1,024 keys of at most 64 characters stay under 100 KiB.
11. **Healthcheck port.** Both Dockerfiles read the port at run time, inside the healthcheck command: `PULSE_HEALTH_PORT`, with `9100` when it is unset or empty. A value that is not 1 to 5 digits makes the check exit 1 without any request. The rest of the command stays: exec form, `bun -e`, `127.0.0.1`, `/healthz`, interval, timeout, start period and retries, `USER bun`.
12. **Verification location.** The image checks are a new step in each target's existing `docker` CI job, so they run on both runner architectures. The api `compose-e2e` job is the cross-service check (see Rollout order).

## Required behavior
1. `/healthz` of a started notifier is 200 at any number of failed polls. `/readyz` is 503 `polls failing (<n> in a row)` from the threshold on and 200 again after one good poll. Both answer `HEAD` as today.
2. Both images turn `healthy` with `PULSE_HEALTH_PORT=9200` and with the default 9100.
3. On a known channel, the first good manual read records the routed manual keys and `manualFrom`, and sends nothing. Later new incidents, updates and resolutions are sent once each. A 404 or a failed read leaves the channel unmarked.
4. Update keys follow decision 5. Inserting an update before existing ones sends only the inserted update.
5. A malformed item on any feed is skipped and counted, and the other items and feeds of the same poll are processed.
6. No application log line contains api response text (decision 8).
7. No api read follows a redirect (decision 9).
8. The malformed-warning cache never holds more than 1024 identities (decision 10).
9. Docs and the upgrade note follow the notify, probe and api tasks below.

## Risks
- **Receivers that parse `update:<n>`.** A webhook or file consumer that reads the index from the key breaks. `docs/channels.md` documents the new form. The `event` field (`update`) is unchanged.
- **Downgrade.** An older notify does not know stable keys or `manualFrom`. After a downgrade, it resends every manual `update` of a known channel whose positional key is missing, and its first rewrite drops `manualFrom`. A later re-upgrade seeds again, quietly. The upgrade note warns about this.
- **Suppressed snapshot.** Manual updates made while notify was down during the upgrade are recorded, not sent (decision 4).
- **Identical updates.** They collapse into one key (decision 5).
- **Lost diagnostics.** Contract reasons and raw ids leave the logs. Operators get `feed`, `index`, a fixed `reason` and, if it is an integer, the `incidentId`. They can fetch the api themselves to see the item.
- **Liveness masks a hung loop.** A poll loop that hangs forever stays live. Request timeouts (`PULSE_NOTIFY_TIMEOUT_MS`) bound every api read, and `tick` never rejects (`src/notifier.ts:288-302`). This is accepted (decision 1).
- **Merge conflict with #559** on `src/ledger.ts` and `src/notifier.ts` (Non-goals).
- **e2e ordering.** If notify merges before the api script change, api's `compose-e2e` fails on its next run, because it builds notify from remote `main` (api `compose.yaml:56`). Rollout order prevents this.

## Performance impact
`bench/budgets.json` exists in api `main` and has `notify` and `probe` sections. The api's own metrics don't move, because only a shell script changes there.
- **notify `startup_cpu_ms`, `startup_wall_ms`, `idle_rss_mib`:** none expected. Startup does the same work. `/readyz` is unchanged, and the bench measures startup at its first 200.
- **notify `load_cpu_s`:** none beyond noise. The new work per poll is one SHA-256 over a JSON string of at most about 2 KiB per manual update and channel, for at most 100 updates per incident (contract `MANUAL_INCIDENT_MAX_UPDATES`). The bench serves few or no manual incidents.
- **notify `peak_rss_mib`:** none in the bench. In the worst case it goes down, because the warning cache is bounded (at most 1024 keys of at most 64 characters) instead of unbounded.
- **notify `test_cpu_s` (gating, budget 2.3 s):** it can rise by roughly 0.1 to 0.3 s from the new tests:
  - liveness: one real server;
  - upgrade and key tests: several notifier polls;
  - malformed, marker and redirect tests: local servers;
  - one poll with 1,025 malformed items;
  - `BoundedSet` unit tests.
  Tests use an injected `schedule`, `now` and `tick()` calls rather than real timers, except the existing health-test pattern. The Docker checks run only in CI, not in `bun run test`.
- **notify and probe `image_mb`:** none. Only the `HEALTHCHECK` line changes, and no file or dependency is added.
- **probe:** none. No source change.
- **How to measure:**
  - Before merge, A/B the test CPU locally in the notify checkout: run `/usr/bin/time -f '%U %S' bun run test` three times on `c090a07` and three times on the branch, and compare the medians of user+system.
  - After notify merges, run `bun bench/run.ts --a main --b main` in an api checkout. Notify side A is the newest `v*` tag and side B is notify `main` (bench/README.md:57). All gating notify metrics must be within `bench/budgets.json`.

## Security impact
Security impact: yes. The change touches the parser and reporting at the notify trust boundary, log texts that carried external data, the redirect behavior of the api reader, ledger file writes, two Dockerfiles and CI files.

Checklist items that apply:
- **Secrets in errors, logs and responses.** No log line or field carries a response body, parser token, header value, `Location`, raw id or contract reason (decision 8). The api url stays redacted (`redactInText`, `src/api.ts:61-71`). Metric labels are only the three fixed feed names.
- **Body and size limits.** `maxBytes` (`PULSE_NOTIFY_API_MAX_BYTES`), the timeout and the wire check stay. The redirect wrapper keeps the `signal`, so the timeout still aborts.
- **Input validation.** Each item is validated on its own. Reporting a rejected item never converts or stringifies a raw value. Only safe integers are copied (decision 7).
- **SSRF and redirects.** No redirect is followed for the api reads (decision 9). Channel posts are unchanged and already don't follow redirects (`docs/troubleshooting.md:51`).
- **Atomic, path-safe writes.** `manualFrom` is written by the existing synchronous `seed` (temp file, fsync, rename) and rolled back on failure. No new path.
- **Dependency pins.** No new package. `node:crypto` is a runtime built-in.
- **Dockerfiles and CI.** The healthcheck builds a URL from an env value. A port that is not 1 to 5 digits exits 1 without a request, so a value like `9100@evil.example/` cannot redirect the check to another host. The CI steps use only local images, local temp files and no secrets.

## Rollout order
Three repositories change. Order:
1. **api** (`scripts/compose-e2e.sh`). The script matches an update key by the prefix `manual:<id>:update:`, which accepts both the positional and the stable form. It still passes against today's notify `main` (key `manual:<id>:update:1`). No running service changes.
2. **probe** (Dockerfile, CI, docs). It is independent and can merge in parallel with step 1. Old deployments that set `PULSE_HEALTH_PORT=9100` or rely on the image default behave the same. Compose files that override the port now get a working healthcheck.
3. **notify,** after step 1 has merged. Consumers that still run:
   - api `compose-e2e` builds notify `main`; it is tolerant since step 1.
   - Status, console and api don't read notify.
   - Webhook, Slack, Teams, email and file receivers see the new key form only for `update` events created after the upgrade. Existing updates are seeded, not resent.
   - An existing notify ledger (version 1 or 2) loads unchanged. Its first good manual read adds `manualFrom` and the stable keys (decision 3).
   - notify keeps its contract pin `61f7bf8` and kit pin `fa79ba8`.

After step 3, rerun the latest api `main` CI run (`gh run rerun <id>` on `lorenzh/pulse-api`). Its `compose-e2e` then builds the new notify and probe `main`. Follow-up in meta (not a target): `README.md:225` still describes the old notify `/healthz`; update it after notify merges.

## Counterexamples
- **Liveness.**
  - `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` at its default 5 and the api answers 500 for 10 polls: `/healthz` must be 200 and `/readyz` must be 503 `polls failing (<n> in a row)`. Today `/healthz` is 503 (`test/health.test.ts:89-124`).
  - A wrong implementation that drops the lifecycle answers `/healthz` 200 after the state lock was lost. The listener still answers then (`src/index.ts:212-220` does not close it), and `/healthz` must be 503 `shutting down`.
- **Healthcheck port.**
  - `PULSE_HEALTH_PORT=9200`: the check must fetch 9200 and nothing listens on 9100. Today it fetches 9100 and the container turns `unhealthy`.
  - A value that is set but empty uses 9100.
  - `PULSE_HEALTH_PORT='9100@evil.example/'`: the check exits 1 and makes no request. Concatenating the value without validation would fetch `evil.example`.
  - An implementation that bakes the port in at build time (`ARG`, or `${PULSE_HEALTH_PORT}` substituted at build) fails the 9200 run-time case.
- **First manual sight** (known channel `web`, v2 ledger `{"version":2,"channels":{"web":{"1:opened":{"status":"delivered","at":1}}}}`):
  - The api serves incident 7, open: creation (`at` 500), then (2000, `identified`, `A`). It also serves incident 8, resolved, with two updates.
  - First good poll: 0 manual deliveries. Today: 4 (`manual:7:opened`, `manual:7:update:1`, `manual:8:opened`, `manual:8:resolved`).
  - The ledger file then holds a finite number `manualFrom.web` and the key `manual:7:update:f678dad88b133092b817969667345bdd` with status `seeded`.
  - Poll 1 answers 404, poll 2 answers 500, poll 3 answers `[]`: polls 1 and 2 write no `manualFrom`, and poll 3 writes it. Then a new incident 9 appears: exactly 1 delivery, `manual:9:opened`. A wrong implementation that marks on 404 is still quiet here, but it fails the next case.
  - Poll 1 answers 404, then poll 2 answers with existing incident 7: 0 deliveries. An implementation that marked on 404 sends incident 7.
  - A seed write fails (the path `<state>.tmp` is a directory): 0 deliveries and no `manualFrom`. After the directory is removed, the next poll writes `manualFrom` and still sends 0.
- **Stable keys** (`manualFrom` already set; handled `[c(500), A(2000,"identified","A"), B(3000,"monitoring","B")]`; the api then serves `[c, X(1000,"investigating","X"), A, B]`):
  - Exactly 1 delivery, key `manual:7:update:944060dad462720cba7f4ef5321c14ae`, message `X`.
  - Today: 1 delivery, key `manual:7:update:3`, message `B` (a resend). X is never sent.
  - The literals come from `printf '%s' '[1000,"investigating","X"]' | sha256sum | cut -c1-32`, `'[2000,"identified","A"]'` → `f678dad88b133092b817969667345bdd` and `'[3000,"monitoring","B"]'` → `c567500cd1fe5d87b5115bdbe2bf5ddb`. They are computed outside notify.
- **Equal-time updates.**
  - Two new updates (2500, `identified`, `p`) and (2500, `identified`, `q`) arrive in one poll: exactly 2 deliveries with different keys.
  - Swapping them in a later answer: 0 deliveries. This already holds today. It is compatibility coverage, not the failing check.
  - A key from `at` alone would send 1.
- **Order validation stays.** An answer whose updates have `at` 3000 then 2000 is rejected by the contract and skipped. It is counted under `manual-incidents` and is not accepted as a reorder.
- **Malformed item isolation.**
  - The `/incidents` body is `[{"id":{"toString":null,"valueOf":null},"checkId":"a","openedAt":1,"resolvedAt":null}, <valid new incident 42>]`. Incident 42 must be delivered in that poll, with 0 `poll failed unexpectedly` lines.
  - Today the poll throws and nothing is delivered.
  - The same holds on `/manual-incidents`, with a valid later manual incident and a new automatic incident in the same poll. On `/checks`, a valid later check still supplies its name.
- **Counter.** The same malformed item served on 2 polls gives `pulse_notify_skipped_items_total{feed="incidents"} 2` and exactly 1 skip log line. A counter tied to the warning gives 1. Valid items add 0.
- **Marker in logs.** The marker is `PULSE_MARKER_7f3a`. These bodies must not leak it into any captured application log line, causes included:
  - the 200 body `PULSE_MARKER_7f3a`;
  - the 200 body `{"a": PULSE_MARKER_7f3a`;
  - a 500 body containing it;
  - a response header `x-pulse-contract: PULSE_MARKER_7f3a`;
  - an incident with `"id":"PULSE_MARKER_7f3a"`;
  - a check with an invalid field and the marker as `id`.
  Each failure still logs its fixed category and `feed`. Today the first body and the string id leak it. Truncating the text would still leak it.
- **Redirects.**
  - Origin A answers `/incidents` with `302 Location: http://127.0.0.1:<B>/incidents`: B gets literal 0 requests, `pulse_notify_feed_polls_total{feed="incidents",outcome="error"}` increases, and the `/checks` and `/manual-incidents` reads of the same poll are still used. Today B gets 1 request.
  - A same-origin `302` from `/checks` to `/checks2` on A: 0 requests to `/checks2`.
  - A `302` on `/manual-incidents` is a feed failure, not an absent feed.
  - A wrong implementation with `redirect: "error"` also follows nothing. It is allowed only if the logged text stays fixed. This spec requires `"manual"`.
- **Bound.**
  - One poll serves 1,025 malformed incidents with ids 1..1025: 1,025 skip lines and counter +1025. The next poll serves ids 1 and 2: exactly 1 line (id 1 was evicted, id 2 is retained), and the counter adds 2.
  - An unbounded set logs 0 lines in the second poll. A set bounded at 1,025 or more also logs 0, which pins the literal 1,024.
  - `BoundedSet(3)` after adding `a`, `b`, `c`, `d`: `size` is 3, `has("a")` is false and `has("d")` is true.

Statistic: `pulse_notify_skipped_items_total{feed}` is a monotonic counter per process. It starts at 0 for each of `incidents`, `checks` and `manual-incidents`, adds 1 per rejected item per successful read of that feed, and resets on restart. There is no window, percentile or rounding.

## Contract fields
No contract, config or wire change. New names are internal to notify, or a test matcher in api:
- **Ledger field `manualFrom`** (per channel, epoch ms). `grep -rn 'manualFrom' .repos/contract/src .repos/config` gives 0 hits. Also 0 in `.repos/notify/src`.
- **Metric `pulse_notify_skipped_items_total{feed}`.** `grep -rn 'pulse_notify_skipped' .repos/contract/src .repos/config .repos/notify/src .repos/api/scripts` gives 0 hits. The existing notify series are `pulse_notify_polls_total`, `pulse_notify_feed_polls_total`, `pulse_notify_deliveries_total`, `pulse_notify_pending_deliveries` and `pulse_notify_consecutive_failed_polls` (`src/metrics.ts:394-410`), so the new name collides with none. The label values are the existing `FeedName` values (`src/metrics.ts:377`).
- **Key form `manual:<id>:update:<32 hex>`.** `grep -rn ':update:' .repos/contract/src .repos/config` gives 0 hits. Across all clones, it appears only in notify (`src/detector.ts:103`, tests, `docs/channels.md:72`), api `scripts/compose-e2e.sh:497`, and a static website test fixture (`website/test/fixtures/notify-channels.md:72`, only checked for channel names by `src/content/facts.test.ts:61-66`, so no change is needed).
- **Log text `GET <path> returned invalid JSON`.** `grep -rn 'returned invalid JSON' .repos/contract/src .repos/config .repos/notify/src` gives 0 hits.
- **Log fields `feed` and `index` on the skip lines.** `feed` is already a field of `api poll failed` (`src/notifier.ts:369`). These are log fields, not contract names.
- **Module `src/bounded-set.ts`, `BoundedSet` and `MALFORMED_REPORT_LIMIT`.** `grep -rn 'BoundedSet\|bounded-set\|MALFORMED_REPORT_LIMIT' .repos/contract/src .repos/config .repos/notify/src .repos/kit/src` gives 0 hits.

## Repository: api
Files:
- `scripts/compose-e2e.sh`

Behavior change: yes. The e2e check of the manual update key changes from an exact key to a prefix that accepts both key forms (a CI tooling change).

### Tool facts (verified)
- `compose-e2e` is a job in `.github/workflows/ci.yml:66-76` that runs `bash scripts/compose-e2e.sh` (`:73`). `compose.yaml:56` builds notify from `https://github.com/lorenzh/pulse-notify.git#main`, and `compose.yaml:28` builds probe from `main`.
- The `check` job uses `lorenzh/pulse-config/.github/workflows/check.yml@dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`ci.yml:17-18`), which runs `bun run lint`, typecheck and test (`check.yml:27-38`). Lint is `biome check . && pulse-eslint .` (`package.json:16`).
- The pinned config `biome.json` sets `"ignoreUnknown": true` (`biome.json:9`), so Biome does not check `.sh` files. The pinned `check.yml`, `biome.json` and `eslint.config.js` were read with `gh api ...?ref=dc69a126...` and are identical to the config clone.
- No shell linter runs in CI (no `shellcheck` step in `ci.yml`). The script has `# shellcheck` directives only as comments (`scripts/compose-e2e.sh:544`).

### Task
- Add `manual_update_count <file>`, which counts lines of a notify channel file that contain `"key":"manual:${manual_id}:update:` (fixed-string `grep -cF`, prefix).
- At `:497`, wait until `manual_update_count manual-web.jsonl` is exactly 1, with the message `notify sent an update event for manual:${manual_id}`.
- In the loops at `:517-519` and `:527-529`, keep `opened` and `resolved` as exact keys and check the update through `manual_update_count` with expected value 1.
- No other step changes.

### Checks
- `bash -n scripts/compose-e2e.sh` exits 0.
- `bun run check` passes, unchanged.
- The CI `compose-e2e` job is green on the PR. It builds today's notify `main`, which writes `manual:<id>:update:1`, and that key matches the prefix.

### Completion evidence
A pulse-api PR with `Closes lorenzh/pulse-meta#<child>`, the green `compose-e2e` run, and the diff limited to `scripts/compose-e2e.sh`.

## Repository: probe
Files:
- `Dockerfile`
- `.github/workflows/ci.yml`
- `docs/install.md`
- `docs/operation.md`
- `docs/configuration.md`

Behavior change: yes. The image healthcheck reads the port from `PULSE_HEALTH_PORT` at run time.

### Tool facts (verified)
- The healthcheck is `Dockerfile:16-17` (exec form `bun -e`, port 9100 hard-coded). `ENV PULSE_HEALTH_PORT=9100` is at `Dockerfile:9`.
- The `docker` CI job (`ci.yml:19-39`) builds `pulse-probe:local` (`:31`) on `ubuntu-24.04` and `ubuntu-24.04-arm` (`:23`). The `check` job uses the pinned pulse-config `check.yml@dc69a126...` (`ci.yml:17-18`; identical to the clone).
- `bun run check` is lint, typecheck and test (`package.json:19`). Coverage is 80 % of lines (`bunfig.toml:2-3`).
- The probe reads the port with `readPort(env, "PULSE_HEALTH_PORT")` (`src/settings.ts:39`). With a token set, the listener starts before the checks load (`src/main.ts:217-232`), and `/healthz` is 200 while it serves (`docs/operation.md:54`).

### Task
- `Dockerfile:17`: the healthcheck code becomes, in effect:
  ```js
  const p = process.env.PULSE_HEALTH_PORT || '9100';
  if (!/^\d{1,5}$/.test(p)) process.exit(1);
  fetch('http://127.0.0.1:' + p + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))
  ```
  Keep the exec form, `bun -e` and the interval, timeout, start period and retries.
- `.github/workflows/ci.yml`: add a step after the test-file check in the `docker` job, named `Check the healthcheck uses PULSE_HEALTH_PORT`. For each case it runs `docker run -d` with `-e PULSE_PROBE_TOKEN=ci-token -e PULSE_API_URL=http://127.0.0.1:9 --health-interval=2s --health-start-period=0s`. `--health-interval` overrides only the timing, not the image's check command.
  - Case 1: add `-e PULSE_HEALTH_PORT=9200`. It must reach `healthy` (poll `docker inspect -f '{{.State.Health.Status}}'` for up to 60 s, and fail at once on `unhealthy`).
  - Case 1 also checks that `docker exec <c> bun -e "fetch('http://127.0.0.1:9100/healthz').then(()=>process.exit(1),()=>process.exit(0))"` exits 0, so nothing listens on 9100.
  - Case 2 sets no port: the image default 9100 must reach `healthy` the same way.
  - On failure, print `docker logs` and `docker inspect -f '{{json .State.Health}}'`. Always remove the containers.
- Docs:
  - `docs/install.md:36`: the `HEALTHCHECK` fetches `127.0.0.1:$PULSE_HEALTH_PORT/healthz` (9100 when unset or empty), read at run time. `PULSE_HEALTH_PORT=0` (ephemeral) is not supported by the healthcheck.
  - `docs/operation.md:52`: the same.
  - `docs/configuration.md:17`: the Docker image sets 9100, and its healthcheck follows the variable.

### Checks
- The new CI step passes on both runners.
- Run on `50ec9ca`, the same step fails case 1 (`unhealthy`). Show this once, locally or in the PR text.
- `bun run check` passes, unchanged.

### Completion evidence
A pulse-probe PR with `Closes lorenzh/pulse-meta#<child>`. It contains:
- the green `docker` jobs (both architectures);
- the output of the failing case 1 against `50ec9ca`;
- `docker inspect -f '{{json .Config.Healthcheck.Test}}' pulse-probe:local` showing the new command.

## Repository: notify
Files:
- `src/index.ts`
- `src/api.ts`
- `src/notifier.ts`
- `src/detector.ts`
- `src/ledger.ts`
- `src/metrics.ts`
- `src/bounded-set.ts` (new)
- `Dockerfile`
- `.github/workflows/ci.yml`
- `test/health.test.ts`
- `test/manual-incidents.test.ts`
- `test/feeds.test.ts`
- `test/api.test.ts`
- `test/metrics.test.ts`
- `test/ledger.v2.test.ts`
- `test/support.ts`
- `test/manual-upgrade.test.ts` (new)
- `test/api-hostile.test.ts` (new)
- `test/bounded-set.test.ts` (new)
- `README.md`
- `docs/operation.md`
- `docs/configuration.md`
- `docs/channels.md`
- `docs/install.md`
- `docs/troubleshooting.md`

Behavior change: yes. It changes liveness, the healthcheck, manual seeding and keys, skip handling, log texts and the redirect policy.

### Tool facts (verified)
- **Checks.** `bun run check` is lint, typecheck and test (`package.json:17`). Lint is `biome check . && pulse-eslint .` (`package.json:14`). Test is `bun test` (`package.json:13`), with 80 % line coverage (`bunfig.toml:2-3`). The runtime is Bun 1.4.0 (`package.json:9`, `:35`).
- **Shared config.** `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned at `dc69a126bebbe50d8a7339ea1325d51b2ea43d7d` (`package.json:22`). The pinned `eslint.config.js:16` sets `sonarjs/cognitive-complexity` to 15. The pinned files are identical to the config clone.
- **CI.**
  - `check` uses `check.yml@dc69a126...` (`ci.yml:17-18`), which runs lint, typecheck and test (`check.yml:27-38`).
  - The `docker` job (`ci.yml:20-40`) builds `pulse-notify:local` (`:32`) on both architectures (`:24`).
- **Code facts.**
  - `PULSE_NOTIFY_POLL_MS` has a minimum of 1 (`src/config.ts:367`). `PULSE_API_URL` defaults to `http://localhost:3000` (`src/config.ts:340-345`).
  - Tests live in `test/` with the fake api in `test/support.ts` (AGENTS.md "This repository").

### Tasks
1. **Liveness.** In `src/index.ts`, add a `liveness` callback: `shutting down`, `starting`, else `{ ready: true }`. Pass it as `live`, and keep `readiness` as `ready`. Update the `Stoppable.pollHealth` comment (`:40`).
2. **Healthcheck.** Change `Dockerfile:19` exactly as in the probe task (decision 11).
3. **Reader** (`src/api.ts`):
   - Wrap the fetch with `redirect: "manual"` (decision 9).
   - Use the fixed `invalid-json` and `wire-mismatch` texts (decision 8).
   - Change `RejectedIncident` to `{ index; id; reason: SkipReason }`, with `id` set only for a safe integer (decision 7).
   - Map contract errors to `"invalid"`, and keep the three date reasons.
   - `onInvalidCheck(index)`.
4. **Metrics** (`src/metrics.ts`): add the counter `pulse_notify_skipped_items_total` with help `API feed items skipped as malformed, by feed.`, preset to 0 for every `FeedName`, and the method `itemSkipped(feed: FeedName)`.
5. **`src/bounded-set.ts`:** `BoundedSet` as in decision 10.
6. **Notifier** (`src/notifier.ts`):
   - Replace `#reported` (decision 10).
   - Report rejected items with the fields of decision 8. Increment `itemSkipped` once per rejected item and per invalid check.
   - Pass the whole `ManualIncidentsResult` to `#pollChannel`.
   - Add the first-sight seeding (decision 3), with the log line `manual incidents initialized: existing manual incidents skipped` (info, fields `channel` and `incidents`).
   - `#seedChannel` sets `manualFrom` when the manual read was not absent.
   - Keep the order inside `#pollChannel`: automatic first, then manual. Keep the cognitive complexity at 15 or less per function by splitting helpers.
7. **Detector** (`src/detector.ts`): `manualUpdateKey(id, update)` returns the stable key (decision 5). The positional form is used nowhere else.
8. **Ledger** (`src/ledger.ts`):
   - The optional `manualFrom` in `LedgerData`, read in `migrate` as in decision 3.
   - `manualFrom(channelId)`.
   - `seed(channelId, keys, marks)`, which commits and rolls back both marks.
   - Update the class doc.
9. **CI** (`.github/workflows/ci.yml`): add a step after the test-file check in the `docker` job, named `Check the healthcheck uses PULSE_HEALTH_PORT and ignores feed health`.
   - Write `{"channels":[{"id":"log","type":"file","path":"/data/incidents.jsonl"}]}` to `$RUNNER_TEMP/notify.json` and mount it read-only at `/config/notify.json`. Make it world-readable, because the image runs as `bun`.
   - Each container gets `-e PULSE_NOTIFY_CONFIG=/config/notify.json -e PULSE_API_URL=http://127.0.0.1:9 -e PULSE_NOTIFY_POLL_MS=200 --health-interval=2s --health-start-period=0s`. Nothing listens on that api url, so every poll fails.
   - Case 1, `-e PULSE_HEALTH_PORT=9200`:
     - reach `healthy` within 60 s (fail at once on `unhealthy`);
     - nothing listens on 9100 (the same `docker exec` check as probe);
     - then wait 15 s (at least 50 failed polls, more than 3 health retries), after which the status must still be `healthy` and the last `.State.Health.Log` entry must have `ExitCode` 0;
     - `docker exec <c> bun -e "fetch('http://127.0.0.1:9200/readyz').then((r)=>process.exit(r.status===503?0:1),()=>process.exit(1))"` exits 0, which shows that the feed is failing.
   - Case 2: no port set; reach `healthy` on the default 9100.
   - Print logs on failure and always remove the containers.
10. **Docs:**
    - `README.md:7`: `/readyz` turns 503 when polls keep failing, and `/healthz` stays 200 while the loop runs. Add a link to the upgrade note.
    - `docs/configuration.md:17`: `/readyz` returns 503 after this many failed polls.
    - `docs/configuration.md:24`: the healthcheck follows `PULSE_HEALTH_PORT`.
    - `docs/operation.md`:
      - `:57`: describe the stable update key, the `manualFrom` marker and seeding on first sight.
      - `:67`: skipped items on all three feeds are counted (`pulse_notify_skipped_items_total`), and one warning per identity is retained (at most 1024, oldest evicted).
      - `:102`: the log table fields `feed`, `index`, `reason` and `incidentId` (integer only), plus the check skip line.
      - `:128-133`: separate the `/healthz` (lifecycle) and `/readyz` (feed) semantics, and remove the sentence that a Docker `HEALTHCHECK` marks the notifier unhealthy after 5 failed polls.
      - Section `API validation and version check`: no redirect is followed, so `PULSE_API_URL` must be the final endpoint, and api response text is never logged.
      - Add a section `## Upgrading` with the upgrade note:
        - Manual incidents: on the first good `/manual-incidents` read after the upgrade, every channel records the manual incidents and updates it then sees as handled and sends none of them. Updates made while notify was stopped for the upgrade are not sent. A 404 from an older api postpones this until the api serves the feed.
        - Update keys change from `manual:<id>:update:<n>` to `manual:<id>:update:<32 hex>`. Old positional entries stay until pruned. Pending and failed ones are still resent.
        - A downgrade after this upgrade resends the manual updates of known channels once.
        - `/healthz` no longer reflects feed health; monitor `/readyz` or `pulse_notify_consecutive_failed_polls`.
    - `docs/channels.md:72`: the new update key form and its identity rule (decision 5, including the identical-update limit).
    - `docs/install.md:30`: the healthcheck fetches `127.0.0.1:$PULSE_HEALTH_PORT/healthz` (9100 when unset or empty), and port 0 is not supported.
    - `docs/troubleshooting.md:61`: `/readyz` is 503; `/healthz` is not affected.
    - `docs/troubleshooting.md:65`: the new fields, the counter, and the note that the reason is a fixed category.

### Tests (each named test must fail on `c090a07` for the stated reason and pass after)
- **`test/health.test.ts`.** Replace the test at `:89-124` with a test on the same pattern (`main` on port 0, fake api, `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` unset, so the default 5 applies):
  - while the api fails, `/healthz` stays 200 and `/readyz` reaches 503 with `polls failing (<n> in a row)` and the metric at 5 or more;
  - after recovery, `/readyz` is 200;
  - `HEAD /healthz` is 200 while polls fail.
  - Add a test where the state lock is lost (on the pattern of `test/index.lock.test.ts`, with a fake `exit`): `/healthz` is then 503 `shutting down`. This already holds on main and guards the lifecycle part of liveness.
  - On main this test fails because `/healthz` is 503.
- **`test/manual-upgrade.test.ts` (new).** Use hand-written v1 and v2 ledger files in a `mkdtemp` directory, a real `Notifier` with an injected `schedule`/`now`, the fake api and a fake sender or file channel.
  - Run every case of Counterexamples "First manual sight", including the v1 file `{"version":1,"channels":{"web":{"1:opened":"delivered"}}}`.
  - Run the restart case: reload the ledger and use a new notifier, with 0 deliveries.
  - Run a ledger that already holds `manual:7:opened` and `manual:7:update:1` as `delivered`: the first good read seeds and sends 0, and the insertion case afterwards sends exactly the X key.
  - A legacy `pending` `manual:7:update:1` with a payload is resent exactly once at start, and `failed list` still shows its event as `update`.
  - Reminder state (`remindersFrom`) and automatic deliveries are unchanged.
  - The expected keys are the literals in Counterexamples.
  - On main, the first poll sends 4 manual events.
- **`test/manual-incidents.test.ts`, `test/feeds.test.ts`.** Update the expected positional keys (`manual-incidents.test.ts:42`, `:64`, `:150`, `feeds.test.ts:226`, `:238`) to stable literals, computed with the `sha256sum` command from Counterexamples for the fixture's `(at, status, message)`, never with notify's own function.
  - Add the insertion test (exactly 1 delivery, key `...944060dad462720cba7f4ef5321c14ae`) and the equal-time test (2 deliveries, then 0 after a swap).
- **`test/api-hostile.test.ts` (new),** through the real `Notifier` and a local fake api that serves raw body text:
  - malformed-item isolation on all three feeds, including the `{"toString":null,"valueOf":null}` id and a nested object id;
  - the counter (2 polls → `2`, one log line);
  - the marker cases, collecting every log entry with `spyLogger` and asserting that `JSON.stringify(entry)` does not contain `PULSE_MARKER_7f3a`;
  - cross-origin and same-origin redirects with a second local server that counts requests (literal 0);
  - an injected `fetch` that records `init.redirect` and must see `"manual"` for all three paths;
  - the bound case with 1,025 then 2 ids.
  - On main: the poll throws, the marker leaks and B counts 1.
- **`test/bounded-set.test.ts` (new):** the `BoundedSet(3)` case, `add` return values, and no refresh on a repeated `add`.
- **`test/api.test.ts`, `test/metrics.test.ts`, `test/ledger.v2.test.ts`:**
  - update the assertions for the changed `RejectedIncident` shape and texts;
  - the new series is present at 0 for all three feeds;
  - `manualFrom` round-trips through write and load, is dropped for a non-number value, and is rolled back with `seed` when the write fails.
- **`test/support.ts`:** extend the fake api with raw body, status, header and redirect answers as needed.

### Checks
- `bun run check` passes.
- The new CI step passes on both architectures. Against `c090a07`, case 1 turns `unhealthy`. Show this once, locally or in the PR text.
- `grep -n "String(r.id)\|String(id)" src/notifier.ts` prints nothing. Expected value: empty output, written here.
- `grep -n "error.message" src/api.ts` prints nothing. Expected value: empty output, written here. Today it prints `src/api.ts:88` and `:90`.
- Start once with `PULSE_API_URL=http://127.0.0.1:9 PULSE_HEALTH_PORT=0 PULSE_NOTIFY_POLL_MS=200 bun run start`, with a file-channel config. After 5 s, `/healthz` must be 200 and `/readyz` 503. Report the command and the result (AGENTS.md "End-to-end checks").
- The test CPU A/B from Performance impact.

### Completion evidence
A pulse-notify PR with `Closes lorenzh/pulse-meta#<child>`. It contains:
- for each finding (1, 2, 3, 4a-4d), the test that fails on `c090a07`, with its failure reason;
- the green `check` and `docker` jobs;
- the `bun run start` result;
- the test CPU medians.

After merge, the rerun api `main` CI shows `compose-e2e` green, with the run id recorded in the child issue.

## Acceptance evidence
Each check below maps to an item of the issue's acceptance criteria. Expected values are literals in this spec or come from `sha256sum` outside notify.
1. **5 failed polls keep liveness 200.** The notify health test asserts `/healthz` 200 and `/readyz` 503 after at least 5 failed polls (the default threshold), and the CI step after at least 50. It fails on `c090a07` (`/healthz` 503).
2. **`PULSE_HEALTH_PORT=9200` turns healthy.** The notify and probe CI steps reach the literal status `healthy` at 9200 and at 9100, and nothing listens on 9100 in the 9200 case. Both fail on `c090a07` / `50ec9ca` (`unhealthy`).
3. **An upgraded ledger sends no manual incident twice.** `test/manual-upgrade.test.ts` gives 0 manual deliveries on the first and the restarted poll for v1 and v2 ledgers, and exactly 1 for a later event. It fails on `c090a07` (4 deliveries).
4. **A reordered update list sends nothing.** The insertion fixture gives exactly 1 delivery with the literal key `manual:7:update:944060dad462720cba7f4ef5321c14ae`, and A and B are not resent. It fails on `c090a07` (`manual:7:update:3` resent, X lost). The equal-time swap with 0 deliveries is compatibility coverage.
5. **A malformed item does not stop the next item.** A valid incident after the `{"toString":null,"valueOf":null}` id is delivered in the same poll, with the same result on manual and checks. It fails on `c090a07` (the poll throws).
6. **A body with a marker string never appears in a log line.** `PULSE_MARKER_7f3a` is in no serialized log entry. It fails on `c090a07` (`JSON Parse error: Unexpected identifier "PULSE_MARKER_7f3a"` and the raw id).
7. **A cross-origin redirect is not followed.** Origin B counts literal 0 requests. It fails on `c090a07` (1 request).
8. **The dedupe set stays below its bound.** After ids 1..1025, the next poll with ids 1 and 2 logs exactly 1 line, and `BoundedSet(3).size` is 3 after 4 adds. It fails on `c090a07` (0 lines, because the set is unbounded).
9. **CI green; `compose-e2e` green.** The CI of api, probe and notify is green. api `compose-e2e` is green on the api PR (old notify, prefix match) and on the rerun after notify merges (new notify `main`).
