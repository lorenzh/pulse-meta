# Spec #571: notify error-budget and expiry alerts

## Goal

pulse-notify sends only incident events today (`opened`, `update`, `resolved`, `reminder`;
`notify/src/types.ts:1`). The Console design names two more notification routes: "Error budget
below 25%" and "Certificate or domain expires soon". This spec adds three routable warning events
to notify:

- `budget-low`: the error budget of a check SLO or a component SLO is below a threshold
  (default 25), at most once per 24 hours per SLO.
- `tls-expiry` and `domain-expiry`: a TLS certificate or a domain registration expires soon,
  with one warning at 14 days and one at 3 days, and not again in the same expiry episode.

A channel opts in with a new `alerts` list. Channels without it behave exactly as today.

## Decisions

The issue review (`.factory/work/571/issue-review.md`) lists twelve open points. No issue comment
decides any of them. This spec decides them as follows.

1. **Budget, not burn rate.** The alert reads the existing `slo.budgetRemaining` of `GET /checks`
   and `GET /components` (percent of the error budget left; contract `src/schema.ts:593-611`).
   It fires when `budgetRemaining < threshold` (strict). `null` budgets and subjects without
   `slo` never fire. No multi-window burn-rate ratio, no SLO CRUD, no recovery event.
2. **Threshold.** One notify-wide setting, `PULSE_NOTIFY_BUDGET_THRESHOLD`, an integer from 0 to
   100, default 25. No per-channel or per-SLO threshold.
3. **Which SLOs.** Check SLOs (subject kind `check`) and component SLOs (kind `component`).
   A check and a component with the same id are two SLOs with separate state.
4. **"Once per day" means 24 elapsed hours**, not a UTC calendar day. A new `budget-low` event
   for an SLO is due when its budget is low and no event for that SLO was generated in the last
   `86 400 000` ms (`nowMs - lastEventMs >= 86400000`). Recovery and a new drop in that time do
   not bypass it. Missed days during downtime give one event, not one per day.
5. **Expiry milestones and catch-up.** The milestones are fixed at 14 and 3 days, independent of a
   check's `warnDays`. The first fresh observation in `4..14` gives the 14-day warning; the first
   in `0..3` gives the 3-day warning. When the 14-day warning was never sent (first observation
   already `0..3`, or a jump from above 14 to 3 or below), only the 3-day warning is sent.
   Negative values (expired) send nothing.
6. **Expiry episode.** Suppression is per check and episode, not per day. An episode starts with
   its first warning and ends (rearms) only with a fresh, newer observation above 14 days. Small
   increases inside `0..14`, `null`, stale or reordered observations do not rearm. Known limit: a
   renewal that keeps the remaining days at 14 or below (for example a new certificate valid for
   10 days) is not recognized; that episode gets no new warnings. The current wire data has no
   exact expiry time or certificate identity, so this spec does not promise more.
7. **One observation per check.** The observation of a check is `certDaysLeft` of `GET /checks`
   (the api takes it from the newest result over all locations, `api/src/service.ts:793-796`) and
   its time is the largest `locations[].result.timestamp`. No warning per location.
8. **Evaluator and state owner: notify only.** One evaluation per notify installation, after the
   incident processing of a poll. Its state is a new ledger table, separate from the prunable
   per-channel delivery history. The api already serves every input (see "Repository: api is not
   changed" below), so no api, contract or probe change is made.
9. **Opt-in routing.** `alerts` selects the warning kinds of a channel; check filters route check
   subjects, component filters route component subjects. A new `sendIncidents: false` makes a
   warning-only channel. Old channel files keep their behavior.
10. **No replay to late subscribers.** Evaluation is global. A channel that subscribes, or whose
    filters widen, receives the next event that becomes due; past warnings are not sent to it.
    The first evaluation of a kind (no stored state) sends every warning that is due at that time,
    once.
11. **Compose evidence** comes from deploy's unchanged `e2e/compose-e2e.sh`, run by the notify
    implementer against a locally built candidate notify image in a scratch copy of deploy. No
    committed image pin changes. Timing rules are proven by fake-clock tests, not by Compose.

## Scope

- notify: channel config (`alerts`, `sendIncidents`), the threshold setting, reading check state
  and `GET /components`, the budget and expiry evaluation, ledger format 4 with the alert state
  table, three new payload variants for all five channel types, docs.

## Non-goals

- No change to api, contract, probe, status, console, deploy, kit or config.
- No Console UI, no route-management API, no config reload.
- No burn-rate windows, no recovery ("budget back above threshold") event, no per-SLO threshold.
- No expiry warning for plain HTTP checks (they publish no `certDaysLeft`).
- No exact expiry time, no certificate or registration identity, no new probe behavior. The
  probe's `warnDays` status and incident behavior stay as they are.
- No shared state across independent notify installations.
- No change to incident, manual incident or reminder events, their keys or payloads.

## Required behavior

### R1 Channel config

- New optional key `alerts` on every channel type: an array of the strings `"budget-low"`,
  `"tls-expiry"`, `"domain-expiry"`. Absent or empty means no warnings (today's behavior).
  Duplicates are allowed and ignored. Any other value fails startup with
  `channel "<id>": alerts must be an array of "budget-low", "tls-expiry" or "domain-expiry"`.
  The message never repeats the bad value.
- New optional key `sendIncidents`: a boolean, default `true`. Another type fails startup with
  `channel "<id>": sendIncidents must be true or false`.
- `sendIncidents: false` with an absent or empty `alerts` fails startup with
  `channel "<id>": sendIncidents false needs alerts`.
- `sendIncidents: false` with `remindEverySeconds` fails startup with
  `channel "<id>": remindEverySeconds needs sendIncidents`.
- `sendIncidents: false`: the channel receives no `opened`, `update`, `resolved` or `reminder`
  event. The incident and manual-incident keys it would have received are recorded as `seeded`
  in its ledger on each poll (same routing as today), so switching `sendIncidents` back to
  `true` later sends nothing old. The first-poll seeding of a new channel stays as it is.

### R2 Threshold setting

- `PULSE_NOTIFY_BUDGET_THRESHOLD`: integer from 0 to 100, default `25`, read with the pulse-kit
  `readInt` (`{ fallback: 25, min: 0, max: 100 }`). Another value stops startup with
  `PULSE_NOTIFY_BUDGET_THRESHOLD: must be an integer from 0 to 100` (the existing format,
  `notify/docs/configuration.md:28`).
- Changing it takes effect at the next start. It does not reset any stored state: an SLO that got
  an event 2 hours ago gets no new one before its 24 hours end, whatever the new threshold.

### R3 Feeds

- `GET /checks`: each item is still validated with `validateCheck` for names (unchanged). An item
  that is a valid `Check` is also validated with `validateCheckWithState` (contract pin
  `7ce23aaf…`, `src/validate.ts:142`). Only items that pass both enter alert evaluation. A failure
  of the second check is counted with the existing `pulse_notify_skipped_items_total{feed="checks"}`
  and logged once per index with the existing fixed text (`check skipped: malformed data`,
  `reason: "invalid"`).
- `GET /components`: read only when at least one channel has `budget-low` in `alerts`. It uses the
  same client as the other feeds (no redirects, `PULSE_NOTIFY_API_MAX_BYTES`, wire version check,
  timeout). Each item is validated with `validateComponentWithState` (pin `7ce23aaf…`,
  `src/validate.ts:270`); an invalid item is skipped, counted under a new feed label
  `components` and logged once per index with a fixed text. A `404` means "no components" (an
  older api): no component budget is evaluated and the poll is not failed. Any other failure
  fails only this feed: it is logged and counted like the others (`api poll failed`,
  `pulse_notify_feed_polls_total{feed="components",outcome="error"}`), counts as a failed poll
  for `/readyz` like any other feed, and never stops incident or manual detection.
- The feeds are read in parallel, as today. When `/components` is not read, the poll outcome is
  computed from the three existing feeds only.

### R4 When alert evaluation runs

In each poll, after the per-channel incident and manual processing:

- Budget evaluation of check SLOs runs when `/checks` answered; of component SLOs when
  `/components` answered with data. It runs only when at least one channel has `budget-low`.
- Expiry evaluation of a check of type `tls` runs only when at least one channel has
  `tls-expiry`; of type `domain` only when at least one has `domain-expiry`. It needs `/checks`.
- An evaluation of a kind is skipped for the whole poll while any channel that subscribes to that
  kind has no ledger record yet (`ledger.hasChannel` false, that is, it was not seeded). This keeps
  the first-poll seeding of new channels intact and lets no subscribed channel miss an event.
- A failed or skipped evaluation changes no state, so the next poll evaluates again.

### R5 Budget rule

For each subject (check or component) with `slo` present, in one poll at `nowMs = now()`:

- `low` is `slo.budgetRemaining !== null && slo.budgetRemaining < threshold`. No rounding before
  the comparison.
- With no stored state, or `nowMs - lastEventMs >= 86400000`, a low subject generates one event at
  `nowMs` and stores `lastEventMs = nowMs`. Otherwise nothing.
- `nowMs < lastEventMs` (clock went back) generates nothing.
- A subject that is not low changes nothing (no recovery reset).

### R6 Expiry rule

Per check of type `tls` or `domain`, the observation is `(days, observedMs)`:
`days = check.certDaysLeft`, `observedMs = max(locations[].result.timestamp)`. The observation is
used only when all hold:

- `days` is an integer (not `null`, not absent) and `locations` is not empty;
- fresh: `nowMs - observedMs <= 2 * intervalMs + 60000` and `observedMs <= nowMs + 60000`
  (`intervalMs` of the check; factor 2 as the api's `WINDOW_INTERVALS`, `api/src/service.ts:49`);
- newer: `observedMs` is greater than the newest observation time already used for this check
  (kept in memory during the run, and the stored `observedMs` of the last state change after a
  restart).

A used observation moves the per-check state `stage ∈ {none, 14, 3}` (start `none`):

| `days`   | stage `none`                     | stage `14`              | stage `3`          |
| -------- | -------------------------------- | ----------------------- | ------------------ |
| `> 14`   | nothing                          | rearm: stage `none`     | rearm: stage `none`|
| `4..14`  | event milestone 14, stage `14`   | nothing                 | nothing            |
| `0..3`   | event milestone 3, stage `3`     | event milestone 3, stage `3` | nothing       |
| `< 0`    | nothing                          | nothing                 | nothing            |

- The event kind is `tls-expiry` for a `tls` check and `domain-expiry` for a `domain` check, at
  the time of the event.
- The episode start `episodeMs` is the `observedMs` of the observation that left stage `none`.
  A rearm clears it.
- The state is stored only when it changes (event or rearm), with that observation's
  `observedMs`. An unchanged stage writes nothing, so a TLS check every 60 s does not write the
  ledger every minute.

### R7 Event keys

Keys never contain a raw id from the api (api text must not reach a log line,
`notify/docs/operation.md:165`). `<h>` is the first 32 hex characters of the SHA-256 of the
subject id (UTF-8), as `manualUpdateKey` does (`notify/src/detector.ts:107-113`).

- `budget:check:<eventMs>:<h>` and `budget:component:<eventMs>:<h>`
- `expiry:<episodeMs>:<milestone>:<h>` (milestone `14` or `3`; the same key form for TLS and
  domain)

Neither form matches the incident key pattern `^(\d+):` or `^manual:(\d+):`
(`notify/src/ledger.ts:403-404`), so their delivery entries are pruned after
`PULSE_NOTIFY_STATE_RETENTION_DAYS` like other old entries. Suppression does not depend on these
entries: it lives in the alert state (R9).

### R8 Payloads

`Notification` becomes a union discriminated by `event`. The incident variant keeps its exact
fields and JSON. The two new variants (webhook body and file line):

```json
{
  "key": "budget:check:1767268800000:<32 hex>",
  "event": "budget-low",
  "time": "2026-01-01T12:00:00.000Z",
  "timeMs": 1767268800000,
  "subject": { "kind": "check", "id": "api-health", "name": "API health" },
  "budget": {
    "remaining": 18.4,
    "threshold": 25,
    "target": 99.9,
    "availability": 99.8816,
    "windowDays": 30
  }
}
```

```json
{
  "key": "expiry:1767268800000:14:<32 hex>",
  "event": "tls-expiry",
  "time": "2026-01-01T12:00:05.000Z",
  "timeMs": 1767268805000,
  "subject": { "kind": "check", "id": "site-tls", "name": "Site TLS" },
  "expiry": { "daysLeft": 13, "milestone": 14, "observedMs": 1767268800000 }
}
```

- `time`/`timeMs` is the poll time of the event. `subject.kind` is `check` or `component`
  (`component` only for `budget-low`). `subject.name` is the check or component `name` from the
  api. `budget.*` are the raw api values (no rounding) plus the threshold in force.
- The webhook `idempotency-key` header is the key; signing and `x-pulse-timestamp` are unchanged.
- Chat and email (slack, teams, email): a state label `BUDGET LOW`, `TLS EXPIRES SOON` or
  `DOMAIN EXPIRES SOON`, the cleaned subject name (`cleanText`, escaped per channel as today), the
  time and the status link. Budget messages add `Error budget left: <r>% (alert below <t>%)` and
  `Availability: <a>% (target <target>%, 30 days)`; `<r>` is `budgetRemaining` rounded down to
  one decimal (`Math.floor(x * 10) / 10`, printed with `toFixed(1)`), `<a>` is `availability`
  rounded down to three decimals, or `no data` when null. Expiry messages add
  `Expires in: <n> days` (`1 day` for 1, `less than 1 day` for 0) and
  `Kind: TLS certificate` or `Kind: domain registration`. `hideReason` does not apply. The email
  subject is `<prefix><label>: <name>` as today; the Message-ID derives from the key as today.
- Persisted pending and failed payloads of the new variants are resent like others. Pending
  payloads written by an older version are incident payloads and stay readable.

### R9 Ledger format 4 and alert state

- `LEDGER_VERSION` becomes 4. The schema adds one table:

  ```sql
  CREATE TABLE alert_state (
    kind TEXT NOT NULL CHECK (kind IN ('budget-check','budget-component','expiry')),
    subject_id TEXT NOT NULL,
    last_event_at INTEGER,
    stage INTEGER CHECK (stage IN (14, 3)),
    episode_at INTEGER,
    observed_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (kind, subject_id)
  ) STRICT;
  ```

  Budget rows use `last_event_at`; expiry rows use `stage` (NULL = `none`), `episode_at` and
  `observed_at`. Rows are validated at open like the other tables; a bad row refuses the file
  as an unsupported format.
- A new event and its claims are one transaction: the `alert_state` upsert and a `pending` entry
  with the payload for every routed channel that has no entry with that key. Then the
  notification is enqueued on each of those channels; `ChannelDelivery` sees the key as `pending`
  and sends it (`notify/src/delivery.ts`, `#claim`). A failed transaction changes nothing and
  the next poll evaluates again. A crash after the commit resends the pending entries at start
  (`#resendPending`), and no new event is generated.
- A rearm (R6) is its own transaction on `alert_state` only.
- Channels are independent: a failure, retry or `failed` status on one channel does not change
  another channel's delivery or the alert state.
- Opening a format-3 file migrates it: first a consistent copy to `<state>.v3.bak` (for example
  `VACUUM INTO` after removing an old backup), then one transaction that creates `alert_state`
  and sets `user_version = 4`. Every channel, mark and entry is kept. The open logs
  `ledger migrated` with `from: 3` and `backup`, as the JSON migration does. A crash before the
  commit leaves a format-3 file that the next open migrates again. A JSON ledger (format 1 or 2)
  is published directly as format 4. Any other `user_version` stays refused.
- The backup gets mode `0600`, like the ledger (`notify/test/security-ledger-permissions.test.ts`).
- Pruning (hourly, with the existing prune): an `alert_state` row is removed only when its
  `updated_at` is older than `PULSE_NOTIFY_STATE_RETENTION_DAYS` and its subject was absent from
  the last good read of its feed (`/checks` for `budget-check` and `expiry`, `/components` for
  `budget-component`). Before a good read of that feed, nothing of that kind is pruned.
- The `failed list` and `failed resend` subcommands work for the new keys unchanged; `list` shows
  the event name (`budget-low`, `tls-expiry`, `domain-expiry`).

### R10 Routing

A channel gets an event when the kind is in its `alerts` and:

- check subject (`budget-low` of a check, `tls-expiry`, `domain-expiry`): `isRouted` with
  `checks`/`excludeChecks` (globs, exclusion wins), as for incidents;
- component subject: `isManualRouted(channel, [componentId])` with
  `components`/`excludeComponents`, as for manual incidents. Component events are never expanded
  to member checks, and check filters do not apply to them.
- `sendIncidents` does not affect warnings. A warning needs no incident and creates none.

### R11 Docs

README (what notify sends, the new setting), `docs/configuration.md` (setting and channel keys),
`docs/channels.md` (triggers, keys, payloads, routing, a new "Warnings" section with the rules R5,
R6 and the known limits), `docs/channels/*.md` (message content per type), `docs/operation.md`
(ledger format 4, `alert_state`, pruning, upgrade and downgrade) and `docs/development.md` (code
map). The package description in `package.json` may say "incident and warning notifications".

## Risks

- **Downgrade after the format-4 migration.** An older notify refuses a format-4 file and does not
  start. Mitigation: `<state>.v3.bak` and a documented downgrade (stop, restore the backup, remove
  `-wal`/`-shm`; events settled after the upgrade may be sent again).
- **Renewal inside 14 days is not seen** (Decision 6). Documented as a known limit.
- **Long check intervals.** Freshness is `2 * intervalMs + 60 s`. A domain check every 24 h can
  use a count up to 48 h old, so a warning can come up to two days late. A count is never counted
  down by notify.
- **`test_cpu_s` of notify.** The budget is 3.4 s with a measured 3.095 s (`api/bench/README.md:122`).
  The new tests must use fake clocks and in-memory or temp-dir ledgers, few real servers, and no
  sleeps. See "Performance impact".
- **Feed load.** `/components` adds one read per poll only when `budget-low` is subscribed.
- **Late subscribers miss the current warning** (Decision 10). Documented.
- **Global evaluation with no routed channel** still advances the state; the event is then sent
  to nobody. Documented: routing decides recipients, not whether an event exists.

## Performance impact

The api does not change, so no api metric of `api/bench/budgets.json` can move. The notify
section (`api/bench/budgets.json`, key `notify`) can move:

- `test_cpu_s` (gating, budget 3.4 s, floor 1.5 s): up. Expected about +0.1 to +0.3 s for the
  new tests. This is the tight one: keep the new tests on fake time and in-memory/temp ledgers.
- `startup_cpu_ms` (gating, 455 ms): unchanged for a format-4 file. One-time cost of the
  format-3 migration (one `VACUUM INTO` and one `CREATE TABLE`) on the first start: a few ms on
  a small ledger. No new dependency, so module load is the same.
- `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib` (gating): none expected. The bench config of
  notify (`api/bench/compose.bench.yaml`) has no `alerts`, so no extra feed is read and no
  evaluation runs. With alerts on, evaluation is a linear pass over the checks per poll.
- Reported: `startup_wall_ms` none expected; `image_mb` none (no new dependency or file type).
  p95 latency and requests per second are api metrics: none.

How to measure: `bun bench/run.ts` takes api refs, and `--others-ref` pins all other
repositories to one ref on both sides (`api/bench/README.md:76-81`), so it cannot compare a notify
branch alone. The notify implementer measures `test_cpu_s` locally: five runs each of
`/usr/bin/time -f "%U %S" bun run test` on `origin/main` and on the branch, on the same machine,
and reports the median of user + system seconds of both and the difference. The difference must
be below 0.3 s (literal limit from this spec: the headroom between 3.095 s and 3.4 s). Startup
CPU: start once with a format-3 ledger copy and once with format 4 and report both, read from
`/proc/<pid>/stat` or `/usr/bin/time` until the first `200` of `/readyz`.

## Security impact

Security impact: yes
The change parses new config keys and an env var, validates new JSON from the api at a trust
boundary, puts api-sourced names into chat and email text, and writes a new file (the ledger
backup) during a format migration.

Checklist items that apply:

- **Secrets in errors, logs and responses:** config errors never repeat the bad value; no api
  text (names, ids, bodies) reaches a log line: keys use the SHA-256 prefix of the subject id
  (R7), skipped items are logged with fixed texts and indexes only. Webhook URLs and SMTP
  passwords stay out of logs as today.
- **Input validation:** check state and components are validated with the contract validators
  before use; `budgetRemaining` must be finite or null (contract `finite.nullable()`),
  `certDaysLeft` an integer or null, timestamps integers; stale, future and older observations
  are rejected (R6). Config values are validated by the zod `strictObject` schemas.
- **Body and size limits:** `/components` uses the same capped, no-redirect reader as the other
  feeds (`PULSE_NOTIFY_API_MAX_BYTES`).
- **SSRF and redirects:** no new outbound target; `/components` follows no redirect.
- **Atomic, path-safe writes:** the migration writes the backup beside the ledger with mode
  `0600`, removes an old backup first, and changes the ledger in one transaction; a crash leaves a
  format-3 file or a format-4 file, never a mix.
- **Output escaping:** subject names pass `cleanText` and the per-channel escaping (Slack `& < >`,
  Teams markdown) as incident names do; a name with `<!channel>` or `**` must not render as markup.
- Dependency pins: no change (contract `7ce23aaf…`, kit `236df214…` stay).

Hostile inputs for the security state: a component or check name of 10 000 characters with
control characters and `<!channel>`; an id with `:` and newlines (the key must still be
`budget:check:<ms>:<32 hex>`); `budgetRemaining` given as a string, `NaN` text or `1e999`
(validator rejects); `certDaysLeft: 3.5`; a `/components` body over the byte cap; a `302` on
`/components`; `alerts: ["budget-low", {"x":1}]`; `PULSE_NOTIFY_BUDGET_THRESHOLD=25abc`; a
pre-existing `<state>.v3.bak` symlink (the migration must remove it and not write through it).

## Rollout order

One repository: only notify changes. It keeps its contract pin `7ce23aaf…`, which already
exports `validateCheckWithState` and `validateComponentWithState` and carries `slo` and
`certDaysLeft` in the read models (`src/validate.ts:142` and `:270`, `src/schema.ts:593-627` and `:769` at
that ref, read with `gh api …?ref=7ce23aaf…`).

Older peers keep working:

- api on an older version without `/components`: `404` is "no components" (R3); check budgets and
  expiry still work.
- api without `slo` or `certDaysLeft` on a check: no warning for that check.
- Webhook and file receivers: new event values reach only channels that opt in with `alerts`.
  Existing channels get the same payloads as before.
- deploy: `e2e/notify.json` and the full/demo channel files have no new keys and stay valid; the
  published image pins do not change in this feature.
- Downgrade of notify after the first start of the new version needs the backup (Risks).

## Counterexamples

Sources of the expected values: literals in this spec (the request's 25 %, 14 and 3 days, and
the decisions above). No test may derive an expected value from the code under test.

Budget (threshold 25, check `a` with `slo.target` 99.9 unless said):

| Input | Expected | A wrong implementation that fails it |
| --- | --- | --- |
| `budgetRemaining` 25 | 0 events | `<=` instead of `<` |
| 24.999 | 1 event | rounding to an integer before comparing |
| `null` (availability null) | 0 events | treating null as 0 |
| no `slo` field | 0 events | default target |
| 0 and -50 | 1 event each (separate checks) | `0 < x < threshold` range check |
| event at `t0`; still low at `t0 + 86399999` | 0 more | calendar-day bucket (if `t0` is 23:59 UTC) |
| still low at `t0 + 86400000` | exactly 1 more | `>` instead of `>=` |
| low at `t0`, 80 at `t0+1h`, 10 at `t0+2h` | 0 more before `t0+24h` | reset on recovery |
| ledger closed and reopened at `t0+1h`, still low | 0 more | in-memory suppression only |
| check `a` and component `a` both low at `t0` | 2 events, 2 different keys | state keyed by id only |
| threshold changed 25 → 50 at restart, `t0+2h` | 0 more | state keyed by threshold |
| `now()` steps back to `t0 - 1000` | 0 events | `Math.abs` of the difference |
| notify down from `t0+1h` to `t0+72h`, low on return | exactly 1 event | one event per missed day |
| `budget-low` on two channels | 1 alert row, 1 entry per channel with the same key | one evaluation per channel |

Expiry (TLS check, `intervalMs` 60 000, each observation newer than the last and fresh):

| Observations in order | Expected events (milestones) |
| --- | --- |
| `15, 14, 14, 13, 4, 3, 3, 2, 0, -1` | `[14, 3]` (at the first 14 and the first 3) |
| same, then `90`, `14`, `3` | two more: `[14, 3]` with a new `episodeMs` |
| `15, 13` | `[14]` once |
| `13, 2` (13 first) | `[14, 3]` |
| first observation `2` | `[3]` only, never `[14, 3]` together |
| first observation `0` | `[3]` |
| first observation `-1` | `[]` |
| `14, null, 13` | `[14]`; null does not rearm or count as 0 |
| `14, 13, 14, 12` | `[14]`; a small increase does not rearm |
| `14` then a restart (reopen ledger) then `14`, `13` | `[14]` total |
| `14` then delivery prune with retention 1 day at `+2 days`, then `13` | `[14]` total |
| `3` used at `observedMs` 1000, then `20` at `observedMs` 900 | no rearm (older) |
| `3` at `observedMs` 1000, then `20` at `observedMs` 1000 | no rearm (not newer) |
| `14` with `nowMs - observedMs = 180001` (2 × 60 000 + 60 000 + 1) | ignored (stale) |
| `14` with `nowMs - observedMs = 180000` | used |
| `14` with `observedMs = nowMs + 60001` | ignored (future) |
| domain check, same sequence as row 1 | `[14, 3]` as `domain-expiry` |
| two locations, newest at t=2000 with check `certDaysLeft` 10, other at t=1000 | one event, observedMs 2000 |

Routing and config:

- Channel `{ alerts: ["budget-low"], checks: ["api-*"] }`: check `api-1` low → event;
  check `web-1` low → none; component `web` low → event (component filters absent).
- Channel `{ alerts: ["budget-low"], components: ["web"], excludeComponents: ["web"] }`:
  component `web` → none (exclusion wins).
- Channel with `alerts: ["tls-expiry"]`: a domain check at 14 → none.
- Channel without `alerts`: no warning at all, and incident payloads byte-identical to main.
- `sendIncidents: false`: an incident that opens → no `opened` event on that channel, its key is
  `seeded`; after a restart with `sendIncidents: true` that incident's `resolved` is sent but
  not its `opened`.
- Rejected configs: `alerts: ["budget"]`, `alerts: "budget-low"`, `alerts: [1]`,
  `sendIncidents: "no"`, `sendIncidents: false` without `alerts`,
  `sendIncidents: false` with `remindEverySeconds: 60`.
- `PULSE_NOTIFY_BUDGET_THRESHOLD`: `101`, `-1`, `25.5`, `abc` stop startup; `0` and `100` start.
  With `0`, budget `0` → none, `-0.1` → event.

Statistics: notify computes no statistic. `budgetRemaining` and `availability` are the api's
values (30 UTC calendar days, result-weighted, `api/src/slo.ts:11-21`, unrounded). Display
rounding is only in chat and email text: round down (`Math.floor`) to 0.1 for the budget and to
0.001 for availability; examples: `24.96` → `24.9`, `-3.25` → `-3.3`, `99.8816` → `99.881`.
The comparison with the threshold always uses the unrounded value.

## Contract fields

No contract or api name is added or renamed. New names local to notify, each searched in the
contract source, the config clone and notify's source on the inspected commits (contract
`2c4e0e0`, config `bc87049`, notify `227fd6d`):

| Name | Where | Search | Result |
| --- | --- | --- | --- |
| `alerts` | channel key | `grep -rn 'alerts' .repos/contract/src .repos/config .repos/notify/src` | no match |
| `sendIncidents` | channel key | `grep -rn 'sendIncidents' …same paths` | no match |
| `budget-low` | event, alert kind | `grep -rn 'budget-low' …` | no match |
| `tls-expiry` | event, alert kind | `grep -rn 'tls-expiry' …` | no match |
| `domain-expiry` | event, alert kind | `grep -rn 'domain-expiry' …` | no match |
| `PULSE_NOTIFY_BUDGET_THRESHOLD` | env var | `grep -rn 'BUDGET_THRESHOLD' …` | no match |
| `alert_state` | ledger table | `grep -rn 'alert_state' …` | no match |
| `subject` | payload field | `grep -rn 'subject' .repos/contract/src .repos/notify/src` | contract: none; notify: only the email `subject` header (`src/channels/email.ts`), a different layer |
| `budget`, `expiry` | payload fields | `grep -rn '"budget"\|expiry' .repos/contract/src` | only doc comments in `schema.ts` (lines 516, 933, 950, 985); no field |
| `daysLeft`, `milestone`, `observedMs` | payload fields | `grep -rn 'daysLeft\b\|milestone\|observedMs' …` | no match (`certDaysLeft` is a different, contract name and is not reused) |
| `components` | metric feed label | `FEED_NAMES` in `notify/src/metrics.ts:6-8` | not a label yet; `/components` is the existing api route |
| keys `budget:…`, `expiry:…` | event keys | ledger patterns `notify/src/ledger.ts:402-404` | do not match `^(\d+):`, `^(\d+):reminder:`, `^manual:` |

## Unchanged repositories

api: the issue names api, but every input exists on api `main` `2bc5910`:
`GET /checks` returns `CheckWithState` with `slo` (`api/src/service.ts:993-998`) and, for `tls` and
`domain` checks, `certDaysLeft` of the newest result (`api/src/service.ts:793-796`);
`GET /components` returns `slo` per component (`api/src/server.ts:675-682`,
`api/src/components.ts:37`); `buildSlo` computes `budgetRemaining` (`api/src/slo.ts:15-21`).
No api task is opened.

## Repository: notify

Files:
- `src/types.ts` (Notification union with `IncidentNotification`, `BudgetNotification`, `ExpiryNotification`; `alerts`, `sendIncidents` on `ChannelBase`)
- `src/channel-schema.ts` (`alerts`, `sendIncidents` and the cross-field rules of R1)
- `src/config.ts` (`PULSE_NOTIFY_BUDGET_THRESHOLD`; channel resolution passes the new keys)
- `src/index.ts` (wires the threshold into the notifier)
- `src/api.ts` (`fetchChecks` also returns the validated states; new `fetchComponents` with 404 as absent)
- `src/metrics.ts` (feed label `components`)
- `src/budget-alerts.ts` (new: pure budget rule R5 and key R7)
- `src/expiry-alerts.ts` (new: pure observation selection and stage machine R6 and key R7)
- `src/notifier.ts` (feeds, evaluation order R4, `sendIncidents`, claims and enqueue, pruning, `isStale` narrowing)
- `src/ledger.ts` (format 4, `alert_state`, v3 migration with backup, the event transaction, alert pruning)
- `src/channels/routing.ts` (whether a channel wants a warning event, R10)
- `src/channels/message.ts`, `src/channels/slack.ts`, `src/channels/teams.ts`, `src/channels/email.ts` (labels and lines of R8)
- `test/support.ts` (fake api: `/components`, checks with state fields)
- `test/budget-alerts.test.ts`, `test/expiry-alerts.test.ts`, `test/alerts.test.ts` (new: notifier with the fake api and a receiver), `test/ledger.v4.test.ts` (new)
- `test/config.test.ts`, `test/message.test.ts`, `test/routing.test.ts`, `test/webhook.test.ts`, `test/failed-cli.test.ts`, `test/prune.test.ts`, `test/security-ledger-permissions.test.ts` (new cases)
- `README.md`, `docs/configuration.md`, `docs/channels.md`, `docs/channels/webhook.md`, `docs/channels/file.md`, `docs/channels/slack.md`, `docs/channels/teams.md`, `docs/channels/email.md`, `docs/operation.md`, `docs/development.md`
- `package.json` (description text only; no dependency or pin change)

Behavior change: yes
New config keys, a new setting, a new feed read, new events and a new ledger format.

Behavior: R1-R11. Module split: the budget and expiry rules are pure functions over parsed
contract types and stored state, with `nowMs` passed in (AGENTS.md "Keep logic pure"); the
notifier does I/O and wiring; the ledger owns persistence. Names of new modules and functions may
differ if the responsibility split stays. Keep cognitive complexity per function at most 15
(enforced by the shared ESLint config). Do not change existing tests' expectations, except where
a test asserts the ledger `user_version` 3 or the exact `FEED_NAMES` list; such a test is updated
to 4 or the new list, and the PR names each one.

TDD order (red first): config rejection of `alerts` (fails on main: `strictObject` rejects the
unknown key), budget once per 24 h, expiry `[14, 3]`, then the rest. Record the failing run of
the budget and expiry tests on `main` in the PR (test names and the failure line).

Tool facts (verified at notify `227fd6d649bc71b5291b7cb47eb3adc08f6ff42d`):
- Bun 1.4.0: `package.json:9` (`engines.bun`) and `package.json:35` (`packageManager`).
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:17`);
  lint is `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`), Biome `2.6.3`
  (`package.json:21`); typecheck is `tsc --noEmit` of `typescript7` = `npm:typescript@7.0.2`
  (`package.json:12`, `:27`); test is `bun test` (`package.json:13`).
- `bunfig.toml:1-4`: `[test]` coverage on, line threshold 0.8, `test/**` excluded from coverage.
- `biome.json:2` extends `@lorenzh/pulse-config/biome.json`, pinned at
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` (`package.json:22`). The pinned file, read with
  `gh api "repos/lorenzh/pulse-config/contents/biome.json?ref=04108fa…"`, is identical to the
  config clone (`bc87049`); `files.includes` (lines 10-17) covers `**` except `dist`,
  `node_modules`, `bun.lock`, `*.html` and `test/fixtures`, so new `src/` and `test/` files are
  linted.
- CI: `.github/workflows/ci.yml:18` uses `check.yml@04108fa…` without `build`; the pinned
  `check.yml` is identical to the clone and runs install, lint, typecheck and test (lines 25-38).
  The `docker` job builds the image (`ci.yml:32`), checks dotenv files (`:34`), the absence of
  test files (`:35-42`) and the healthcheck (`:43-…`).
- Contract pin `7ce23aaf3fa3e038f65ecfed755188b83bde143f` (`package.json:30`) exports
  `validateCheckWithState` and `validateComponentWithState` (that ref's `src/validate.ts:142`,
  `:270`). Kit pin `236df214f9df8658f2992dd6f7c100952c07102b` (`package.json:31`) has
  `readInt` with `max` (that ref's `src/settings.ts:55-61`). No pin changes.

Checks and completion evidence:
1. `bun run check` exits 0.
2. `bun test test/budget-alerts.test.ts test/expiry-alerts.test.ts test/alerts.test.ts test/ledger.v4.test.ts`
   passes and covers every row of "Counterexamples" with the literal inputs and expected values
   of this spec. The same budget and expiry behavior tests fail on `origin/main` (shown in the PR:
   names and the failing assertion or the startup error for the unknown `alerts` key).
3. End to end over HTTP (`test/alerts.test.ts`): the fake api (`test/support.ts`) serves
   `/checks` with a check `api-1` of `slo.budgetRemaining` 24 and a TLS check with
   `certDaysLeft` 13; two webhook channels on a local receiver (`startReceiver`) subscribe; the
   receiver gets exactly 1 `budget-low` and 1 `tls-expiry` request per channel, each with an
   `idempotency-key` equal to the body `key`; a channel without `alerts` gets 0. A receiver that
   answers 500 twice and then 204 gets the same key 3 times and no new key. A 404 on
   `/components` leaves incident delivery and check budgets working.
4. Ledger: a format-3 file made by the `main` code path (or a fixture built with the format-3
   schema in the test) opens as format 4 with every entry and mark kept, `PRAGMA user_version`
   is `4`, `<state>.v3.bak` exists with mode `0600` and `user_version` `3`; a second open does
   not migrate again; a file with `user_version` `5` is refused.
5. Incident behavior unchanged: the existing suites (`notifier`, `reminders*`, `manual-*`,
   `routing-change`, `ledger*`, `prune`, `webhook`, `channels`) pass without changed
   expectations, except the version/feed-list cases named in the PR.
6. Performance: the `test_cpu_s` A/B of "Performance impact" (medians of 5 runs, main and
   branch) with a difference below 0.3 s, and the startup CPU of a format-3 and a format-4 start.
7. Run once by hand: `bun run start` with `PULSE_NOTIFY_CONFIG` pointing at a file channel with
   `alerts: ["budget-low","tls-expiry"]`, `PULSE_API_URL` at a local fake api (for example a
   short `Bun.serve` script outside the repository serving the `/checks`, `/incidents`,
   `/manual-incidents`, `/components` bodies of check 3), and `PULSE_NOTIFY_POLL_MS=1000`. Report
   the command and the file lines: exactly one `budget-low` and one `tls-expiry` line after 10
   polls.
8. Compose: build `docker build -t pulse-notify:candidate .` from the branch. In a scratch copy
   of `lorenzh/pulse-deploy` `main` (not committed), replace the notify `image:` line of
   `common/services.yaml` (line 35 at deploy `c3e340a`) with `pulse-notify:candidate` and run
   `bash e2e/compose-e2e.sh` to completion with exit 0. Report the deploy SHA, the notify commit
   SHA, the candidate image id and the last lines of the output. The api image stays the pinned
   one (api is unchanged). The PR also shows the notify CI `check` and `docker` jobs green.
9. The PR names the issue, the checks that ran and the known limits: renewal inside 14 days is
   not seen; late subscribers get the next due event only; downgrade needs `<state>.v3.bak`;
   warnings can be up to `2 × intervalMs` late.
