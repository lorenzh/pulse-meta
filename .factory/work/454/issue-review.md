# Issue review: #454 notify contract pin and per-feed poll errors

Target: `notify` only. Read from `main` of pulse-notify (`6756f3c`), pulse-contract (`d0b8fca`), pulse-kit (`6a06ec2`) and pulse-api (`352ec49`). There are no earlier decisions in the issue comments.

## What I checked

- `package.json` pins `@lorenzh/pulse-contract#206bf010…` (1.3.0). Contract `main` is `d0b8fca` (1.6.0), 23 commits later. It adds `tcp`, `dns` and `domain` to `checkSchema` / `validateCheck` (contract #398) and adds new exports (admin schemas, latency, locations, SLO). `WIRE_VERSION` is still `1`. Nothing that notify imports was removed or renamed (`Check`, `Incident`, `ManualIncident`, `fetchJson`, `FetchJsonError`, `FetchJsonOptions`, `DEFAULT_MAX_BODY_BYTES`, `Validation`, `validateCheck`, `validateIncident`, `validateManualIncident`). Notify uses `Check` only for `id` and `name`, so we expect no type fixes. The implementer still has to run `typecheck` to confirm.
- In `src/`, contract `d0b8fca` matches `9fe5e80`, the pin of pulse-api and pulse-status. The only change between them is a test. So notify validates checks exactly as the api that serves them does.
- pulse-kit does not depend on pulse-contract. All targets pin kit at `fa79ba8`, so the contract bump does not need a kit bump.
- `src/notifier.ts` `#poll()` loads `fetchIncidents`, `fetchChecks` and `fetchManualIncidents` with one `Promise.all`. If one of them throws, it logs `api poll failed` (every poll, no feed field), counts `pulse_notify_polls_total{outcome="error"}`, sets `#failedPolls++`, and processes nothing.
- When `/manual-incidents` answers 404 (`isAbsent`), today `manual = []` and `#visibleManual` is kept. Other failures throw.
- `test/support.ts` already has a stub with `failing` and `failingManual`. `test/manual-incidents.test.ts` has the test "a failing manual read fails the poll", which asserts `consecutiveFailedPolls === 1`.
- pulse-api `scripts/compose-e2e.sh` (`notify_has_polled`) greps `pulse_notify_polls_total{outcome="ok"} [1-9]` to know that notify finished its first good poll, which seeds the channels. `test/index.test.ts` and `test/metrics.test.ts` assert the same series. Renaming or removing it would break `compose-e2e`.
- `/healthz` and `/readyz` both use `consecutiveFailedPolls >= PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` (`src/index.ts` ~235-249).

## Open points (resolved by assumption, none blocks the spec)

1. **Metric name.** The issue suggests `pulse_notify_poll_total{feed, result}`. The existing aggregate `pulse_notify_polls_total{outcome}` must stay, because compose-e2e and the tests depend on it. Its label is `outcome`, not `result`.
   - Assumption: add a new counter `pulse_notify_feed_polls_total{feed="incidents|checks|manual-incidents", outcome="ok|error"}`. Every series is created at 0 at start, as the existing counters are. Keep `pulse_notify_polls_total{outcome}` unchanged.
   - A 404 on `/manual-incidents` counts as `outcome="ok"`. No third value: the api answered, so nothing failed.
   - Feed label values are the api paths: `incidents`, `checks`, `manual-incidents`.
2. **What a "failed poll" means for health and for the aggregate metric.** The issue says "readiness and liveness keep their current meaning".
   - Assumption: a poll is good only when all three feeds answered. A 404 on manual incidents counts as answered, as today. Any failing feed:
     - increments `#failedPolls`
     - counts the poll as `pulse_notify_polls_total{outcome="error"}`
   - So `/healthz` and `/readyz` behave as today: a broken route still turns them 503 after N polls. They do not turn 503 only when everything fails. The difference is that deliveries for the other feeds continue meanwhile.
   - The existing test "a failing manual read fails the poll" stays valid and gets extended.
   - Alternative not chosen: count only polls where all feeds failed, or where the incidents feed failed. That would change what readiness means, which the issue rules out.
3. **"Logged once per failure kind".**
   - Assumption: log `api poll failed` (level `error`) with `feed` plus the existing `error`, `code`, `cause` fields.
   - Log it once per (feed, failure kind) while the feed keeps failing. When the feed answers again, reset the dedupe, so the next failure logs again.
   - Failure kind is the `FetchJsonError.kind`: `timeout`, `aborted`, `network`, `http`, `too-large`, `invalid-json`, `validation`, `wire-mismatch`. For `http`, the kind includes the status, so 500 and 503 are separate kinds. Today `src/api.ts` turns the kind into a plain `Error` and loses it, so the implementation must keep it (for example a property on the thrown error).
   - An `info` line such as `api feed recovered` with `feed` is welcome but optional.
   - The metric still counts every failing poll. This is a behavior change and must be documented: an unreachable api now logs 3 lines (one per feed), not one line every poll.
4. **Seeding must not run with a feed missing.**
   - Today a channel that is new to the ledger is seeded at its first poll with all current incidents and manual incidents, so that it sends no burst.
   - If the first poll seeded with incidents or manual incidents missing, the next good poll would send every existing incident as new.
   - Assumption: a new channel is seeded only in a poll where both `incidents` and `manual-incidents` answered (a 404 counts, as today). Until then the channel is skipped, and the next poll retries.
   - The checks feed does not gate seeding.
5. **Parts of the incident pipeline when `/incidents` fails.**
   - Assumption: with no incidents this poll, skip every step that needs them:
     - automatic-incident detection
     - `#syncReminderMark` (reminder seeding)
     - `#rebuildLegacyPending`, which would otherwise log `pending notification cannot be rebuilt: incident not found` by mistake
     - `#releaseHeld`, because held reminders need the resolved set
     - updating `#resolved` and `#visible`, which keep their last good values
     - `#pruneLedger`, which runs only on polls where incidents answered
   - Manual incident detection still runs for channels that are already seeded.
6. **Parts of the pipeline when `/manual-incidents` fails** (not a 404).
   - Assumption: skip manual detection for this poll and keep `#visibleManual`, so prune does not remove manual keys.
   - Automatic incidents, reminders, held reminders and prune all go on.
   - "The last known manual set is kept" therefore means the visible id set used for prune. We do not replay the last list into detection, because it would detect nothing new.
7. **Check names when `/checks` fails.**
   - Assumption: the notifier keeps a name map from the last successful `/checks` read. A successful read replaces the whole map. When `/checks` fails, the poll uses that map, and a check with no entry falls back to the id, as today.
   - The map lives in memory only and starts empty at process start.
   - Invalid checks on a successful read are still skipped and logged once (`check skipped: malformed data`), as today.
8. **Contract pin value.** The issue says "current `main` of pulse-contract". That is `d0b8fcae92bdd7f2ac0488a7971466235e4c6e7d` today. The plan should pin the `main` SHA that exists when the build starts. Its `src` matches pulse-api's pin (`9fe5e80`), so using `9fe5e80` would also be correct. `bun.lock` gets updated together with the pin. The kit pin stays at `fa79ba8`.
9. **Docs.**
   - `docs/operation.md`:
     - the per-feed behavior
     - the new `feed` field on `api poll failed`, and its dedupe
     - the new metric row
     - the definition of a failed poll for `/healthz`
     - that checks are validated for all six types
   - `docs/troubleshooting.md`:
     - rows for `api poll failed` with `feed`
     - a note that a feed failing alone still blocks readiness after N polls, but alerts from the other feeds go on
     - fix the existing row "`GET incidents returned <status>` or `GET checks returned <status>`" to name `manual-incidents` too

## Non-goals (from the issue, confirmed)

These stay unchanged:
- channels, routing, ledger format, delivery retry/backoff
- webhook signatures
- the poll interval
- the number of requests per poll

## Derived acceptance check

In pulse-notify, `bun run check` passes, plus these tests:

1. **Check types**: the api stub serves 6 checks, one each of type `http`, `tls`, `heartbeat`, `tcp`, `dns`, `domain`, and an open incident on each. A seeded file channel then gets 6 `opened` notifications, each with `checkName` equal to that check's `name`, and `check skipped: malformed data` is never logged. With the contract pin reverted to `206bf01`, the `tcp`, `dns` and `domain` cases fail (`checkName` is the id). The mutation output goes in the PR.
2. **`/checks` fails (500)**:
   - An incident opened after a good poll is still delivered, with the name from the last good `/checks` read.
   - Without any earlier good read, it is delivered with the check id.
   - The log has `api poll failed` with `feed: "checks"` once over two failing polls.
   - `pulse_notify_feed_polls_total{feed="checks",outcome="error"}` counts both polls.
   - The next poll requests `/checks` again.
3. **`/manual-incidents` fails (500)**: an automatic incident is delivered, no manual incident is resolved or re-sent, and the prune does not remove manual keys of the last known set. Log line with `feed: "manual-incidents"`.
4. **`/incidents` fails (500)**: a new manual incident update on a seeded channel is delivered. No `pending notification cannot be rebuilt` is logged, and held reminders stay held. Log line with `feed: "incidents"`.
5. **New channel, a feed fails at the first poll**: the channel is not seeded. After that feed recovers, the existing incidents are seeded and not sent.
6. **Health**: with any one feed failing, `consecutiveFailedPolls` increases and `pulse_notify_polls_total{outcome="error"}` counts the poll. One poll where all three feeds answer resets it to 0.

Tests 2–4 fail on the current `Promise.all` code.

pulse-api `compose-e2e` stays green: it still sees `pulse_notify_polls_total{outcome="ok"}`.
