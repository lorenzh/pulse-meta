# Spec #454: notify contract pin and per-feed poll errors

## Goal

pulse-notify understands every check type the api serves (`http`, `tls`, `heartbeat`, `tcp`,
`dns`, `domain`). One failing api read never stops the alerts that the other reads can deliver.

Read from `main`: pulse-notify `6756f3c`, pulse-contract `61f7bf8` (1.6.0), pulse-kit, pulse-api
`352ec49` (`scripts/compose-e2e.sh`, `bench/budgets.json`). The issue review is in
`.factory/work/454/issue-review.md`; its assumptions are adopted here as decisions.

## Current behavior (notify `main`)

- `package.json:30` pins `@lorenzh/pulse-contract#206bf010…` (1.3.0). That contract's
  `validateCheck` has no `tcp`, `dns` or `domain` variant, so `fetchChecks` (`src/api.ts`) drops
  such checks through `onInvalidCheck` and logs `check skipped: malformed data` once per error.
  Their incidents alert with `checkName` = check id (`buildNotification`, `src/notifier.ts` ~110).
- `#poll()` (`src/notifier.ts` ~303-345) reads `fetchIncidents`, `fetchChecks` and
  `fetchManualIncidents` with one `Promise.all`. Any rejection logs `api poll failed`
  (`error`, `code`, `cause`, no feed), counts `pulse_notify_polls_total{outcome="error"}`,
  returns `false` (`#failedPolls++`) and processes nothing.
- `/manual-incidents` 404 → `isAbsent`, manual = `[]`, `#visibleManual` kept; the poll is good.
- `src/api.ts` `apiError` turns `FetchJsonError.kind` into a plain `Error`; the kind is lost.
- `/healthz` and `/readyz` turn 503 when `consecutiveFailedPolls >= PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS`.
- pulse-api `scripts/compose-e2e.sh:177` greps `^pulse_notify_polls_total\{outcome="ok"\} [1-9]`.

## Scope

Target `notify` only: contract pin bump with `bun.lock`, per-feed poll handling in
`src/notifier.ts`, error kind kept in `src/api.ts`, a new per-feed counter in `src/metrics.ts`,
tests, and docs.

## Non-goals

- No change to channels, routing, the ledger format, delivery retry/backoff, webhook signatures
  (audit L5), the poll interval or the number of requests per poll (still three).
- No pulse-kit bump: kit does not depend on contract; the pin stays `fa79ba8`.
- No change to `pulse_notify_polls_total{outcome}` (name, label, values) or to what `/healthz`
  and `/readyz` mean.
- No change in contract, api or any other target.

## Required behavior

### 1. Contract pin

- Pin `@lorenzh/pulse-contract` to the full SHA of pulse-contract `main` at build start
  (`61f7bf88c38ab4827fb47e9409e18d37b9a7ccd3` today; its `src` validates checks exactly like
  pulse-api's pin `9fe5e80`). Run `bun install` so `bun.lock` matches; commit both.
- Every symbol notify imports still exists (`Check`, `Incident`, `ManualIncident`, `fetchJson`,
  `FetchJsonError`, `FetchJsonOptions`, `DEFAULT_MAX_BODY_BYTES`, `Validation`, `validateCheck`,
  `validateIncident`, `validateManualIncident`). `WIRE_VERSION` stays `1`. Fix any typecheck error
  the newer `Check` union causes (expected: none; notify reads only `id` and `name`).
- Test fixtures in `test/support.ts` gain builders for `tls`, `tcp`, `dns`, `domain` checks that
  pass the new `validateCheck` (use the contract schemas as the source of required fields).

### 2. Feeds settle independently

`#poll()` fetches the three feeds with `Promise.allSettled` (still in parallel, still one request
each). Feed names, used in logs and metrics, are the api paths: `incidents`, `checks`,
`manual-incidents`.

- **incidents ok**: as today. `#resolved` and `#visible` are replaced from the result.
- **incidents fail**: no automatic-incident work this poll. Skipped: `detectEvents` for
  automatic incidents, `#syncReminderMark`, `#rebuildLegacyPending`, `#releaseHeld`, the update of
  `#resolved` and `#visible` (they keep their last good values), and `#pruneLedger`.
  Manual-incident detection still runs for channels that are already seeded.
- **checks ok**: the notifier replaces a name map field (`#checkNames`, in memory, empty at start)
  with the names of the valid checks of this read. Invalid checks are skipped and logged once as
  today.
- **checks fail**: the poll uses the last `#checkNames`; a check without an entry falls back to its
  id (as today). Checks never gate any other step.
- **manual-incidents ok / 404**: as today (404 = absent, `[]`, `#visibleManual` kept, counts as
  answered).
- **manual-incidents fail** (any other error): manual detection is skipped this poll and
  `#visibleManual` is kept, so prune does not drop manual keys. Automatic incidents, reminders,
  held reminders and prune go on. "Keeps the last manual set" means the visible id set used by
  prune; the last list is not replayed into detection.
- **Seeding**: a channel not yet in the ledger is seeded only in a poll where both `incidents`
  and `manual-incidents` answered (404 counts as answered). Otherwise the channel is skipped this
  poll (no seed, no detection, no log line per poll beyond the feed failure) and the next poll
  retries. This prevents a burst of old incidents after a feed recovers.
- Rejected incidents / manual incidents of answered feeds are still reported as today.

### 3. Failure logging

- Each failing feed logs `api poll failed` at `error` with `feed` plus the existing `error`,
  `code`, `cause` fields (redaction unchanged: `redactedError` still removes the api url; no new
  external text is logged).
- Dedupe: once per (feed, failure kind) while that feed keeps failing. Failure kind is
  `FetchJsonError.kind`; for `http` the kind includes the status (`http:500` ≠ `http:503`). A
  network error whose `cause` is not a `FetchJsonError` (should not happen) uses `unknown`.
  When the feed answers again, its dedupe entries are cleared, so the next failure logs again.
  Optional: `info` `api feed recovered` with `feed` when a feed answers after a logged failure.
- `src/api.ts` keeps the kind on the thrown error (for example a `kind` property set by
  `redactedError`/`apiError`), without changing the message texts.
- This is a documented behavior change: an unreachable api logs three lines (one per feed) once,
  not one line every poll. The metric still counts every failing poll.

### 4. Metrics

- New counter `pulse_notify_feed_polls_total{feed="incidents|checks|manual-incidents",outcome="ok|error"}`,
  help text "API feed reads by feed and outcome.". All six series exist at 0 from start (like the
  existing counters). One increment per feed per poll. A 404 on `manual-incidents` is `ok`.
- `pulse_notify_polls_total{outcome}` is unchanged: `ok` only when all three feeds answered,
  otherwise `error`.

### 5. Health

- A poll is good only when all three feeds answered (404 on manual counts). Any failing feed makes
  `#poll()` return `false`, so `#failedPolls` grows and `/healthz` / `/readyz` turn 503 after
  `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` polls, exactly as today. Deliveries for the answered
  feeds go on meanwhile. One poll with all three feeds answering resets the count to 0.

### 6. Docs

- `docs/operation.md`: per-feed behavior (table: which steps run when each feed fails); `feed`
  field and dedupe on `api poll failed` (log table row ~88); the new metric row (~124); the
  definition of a failed poll for `/healthz` (~117); checks validated for all six types.
- `docs/troubleshooting.md`: `api poll failed` rows mention `feed`; row ~49 names
  `GET manual-incidents returned <status>` too; `/healthz` 503 row (~61) notes that one failing
  feed alone still blocks readiness after N polls while the other feeds keep alerting.

## Performance impact

None expected: the same three requests per poll, settled with `allSettled` instead of `all`, and
one small in-memory name map (one entry per check, already built every poll today). No key of
`bench/budgets.json` `notify` (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`,
`test_cpu_s`, `startup_wall_ms`, `image_mb`) should move beyond noise. `test_cpu_s` may rise a
little from the new tests (well under 0.1 s). The newer contract adds code to the dependency, so
`image_mb` may grow by a few kB. The implementer checks with `bun test` wall time before/after; no
bench A/B run is required.

## Security impact

Security impact: yes. The change bumps a dependency pin and changes error log lines that carry
text from the api.

Checklist items that apply:
- **Dependency pins**: contract pinned to a full commit SHA of `main`, `bun.lock` regenerated, no
  new package, kit unchanged (all runtime deps stay in `docs/approved-packages.md`).
- **Secrets in errors and logs**: the new `feed` field is one of three constants; `error`, `code`
  and `cause` still pass through `redactedError` (api url redacted, original cause dropped). The
  dedupe key uses only the error kind and the HTTP status, never response text.
- **Input validation**: checks are now validated with the newer `validateCheck` (six types);
  invalid entries are still skipped one by one, never fail the feed.

## Rollout order

One repository: only pulse-notify changes. It keeps working against every api that runs today:
the contract bump keeps `WIRE_VERSION` 1, the api already serves the newer check shapes (its pin
`9fe5e80` has the same `src`), and an older api without `/manual-incidents` still answers 404,
which counts as answered. pulse-api `compose-e2e` keeps finding
`pulse_notify_polls_total{outcome="ok"}`.

## Counterexamples

- A `tcp` check `{id:"c4", name:"DB port", type:"tcp", …}` with an open incident: a wrong
  implementation (old pin) sends `checkName: "c4"` and logs `check skipped: malformed data`.
  Required: `checkName: "DB port"`, no such log.
- `/checks` answers 500 for two polls: logging `api poll failed` twice is wrong (dedupe); not
  counting the second poll in `pulse_notify_feed_polls_total{feed="checks",outcome="error"}` is
  wrong (metric counts every poll, value 2). Dropping the incident is wrong.
- `/checks` answers 500 then 503: two log lines (different kinds). 500, then ok, then 500: two
  log lines (dedupe reset on recovery).
- `/checks` fails after a good read where `c1` was named "API": a new incident on `c1` must carry
  `"API"`, not `"c1"` (the map must not be cleared on failure).
- A good `/checks` read that no longer lists `c1`: the name of `c1` is gone (map replaced, not
  merged); its incident uses the id.
- `/manual-incidents` answers 500 while manual incident `m7` is open and its ledger key is old: the
  hourly prune must not remove `m7`'s keys (`#visibleManual` kept), and `m7` must not be sent as
  resolved.
- `/manual-incidents` answers 404: counts `outcome="ok"` for that feed, no `api poll failed`, poll
  good (health count reset).
- `/incidents` answers 500 while a legacy pending key exists: no `pending notification cannot be
  rebuilt: incident not found` log; held reminders stay held (not released).
- `/incidents` answers 500 at a new channel's first poll: seeding with `[]` incidents is wrong
  (the next good poll would send every open incident). Required: no seed; seed at the first poll
  where incidents and manual-incidents answer, with zero notifications sent for existing items.
- Health: with only `/checks` failing for `PULSE_NOTIFY_HEALTH_MAX_FAILED_POLLS` polls, `/healthz`
  must be 503 (counting only all-feed failures is wrong); `pulse_notify_polls_total{outcome="error"}`
  counts each of those polls.

No statistics are defined by this spec (counters only).

## Contract fields

New names, all in pulse-notify only (no contract or config change):

- Metric `pulse_notify_feed_polls_total` with labels `feed`, `outcome`.
- Log field `feed` on `api poll failed`; optional log message `api feed recovered`.

Searches proving no collision:

```
$ grep -rn 'feed_polls' .repos/contract/src .repos/config/src .repos/kit/src .repos/notify/src
(no output)
$ grep -rn '"feed"' .repos/contract/src .repos/config/src .repos/kit/src .repos/notify/src
(no output)
$ grep -rn 'feed:' .repos/contract/src .repos/config/src .repos/kit/src .repos/notify/src
(no output)
$ grep -rln 'feed' .repos/contract/src .repos/config/src .repos/kit/src
(no output)
```

Feed label values (`incidents`, `checks`, `manual-incidents`) are the existing api route names.

## Repository: notify

Files:
- `package.json` (contract pin)
- `bun.lock`
- `src/api.ts` (keep the `FetchJsonError` kind and HTTP status on the thrown error)
- `src/notifier.ts` (`#poll` with `Promise.allSettled`, per-feed paths, `#checkNames`, seeding gate,
  per-feed log dedupe)
- `src/metrics.ts` (`pulse_notify_feed_polls_total`, `feedPollDone(feed, outcome)`)
- `test/support.ts` (fake api: per-path failure, e.g. `failingPaths: Set<string>` with a status;
  keep `failing` / `failingManual` working; check builders for all six types)
- `test/check-types.test.ts` (new)
- `test/feeds.test.ts` (new; may instead extend `test/manual-incidents.test.ts` and
  `test/notifier.test.ts`)
- `test/metrics.test.ts`, `test/manual-incidents.test.ts` (adjust/extend existing assertions)
- `docs/operation.md`, `docs/troubleshooting.md`

Behavior: sections 1-6 of Required behavior.

Checks (each test named for its case):
1. **Check types**: the stub serves six checks, one each of `http`, `tls`, `heartbeat`, `tcp`,
   `dns`, `domain`, and an open incident on each; a seeded file channel gets six `opened`
   notifications whose `checkName` equals the check `name`; `check skipped: malformed data` is
   never logged.
2. **`/checks` 500**: an incident opened after a good poll is delivered with the name from the last
   good read; with no good read ever, with the check id. Over two failing polls: one
   `api poll failed` with `feed: "checks"`, and
   `pulse_notify_feed_polls_total{feed="checks",outcome="error"} 2`. The stub sees `/checks`
   requested again on the next poll. 500→503 logs twice; 500→ok→500 logs twice.
3. **`/manual-incidents` 500**: an automatic incident is delivered; no manual incident is resolved
   or re-sent; prune keeps the manual keys of the last known set; log has
   `feed: "manual-incidents"`.
4. **`/incidents` 500**: a new update of a manual incident on a seeded channel is delivered; no
   `pending notification cannot be rebuilt` log; held reminders stay held; log has
   `feed: "incidents"`.
5. **Seeding gate**: a new channel with `/incidents` (and separately `/manual-incidents`) failing at
   its first poll is not seeded; after the feed recovers, existing incidents are seeded and none is
   sent.
6. **Health**: with any one feed failing, `consecutiveFailedPolls` grows and
   `pulse_notify_polls_total{outcome="error"}` counts the poll; one all-good poll resets it to 0.
   A 404 on manual counts as good. The existing test "a failing manual read fails the poll" stays
   green.
7. **Metrics**: all six `pulse_notify_feed_polls_total` series render `0` before the first poll;
   `pulse_notify_polls_total{outcome="ok"}` is unchanged.

Completion evidence (in the PR body):
- `bun run check` passes (lint, typecheck, tests); CI green.
- Mutation output: with the contract pin reverted to `206bf01`, test 1 fails for `tcp`, `dns`,
  `domain`; with `#poll` reverted to `Promise.all`, tests 2-4 fail. Paste both outputs.
- `grep -n pulse-contract package.json bun.lock` showing the new SHA.
- pulse-api `compose-e2e` is unaffected (`pulse_notify_polls_total{outcome="ok"}` unchanged);
  state that the series and its semantics did not change.
