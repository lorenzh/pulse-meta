# Spec #737: notify keeps the ledger dedupe of a filtered manual incident across retention expiry

Issue: [#737](https://github.com/lorenzh/pulse-meta/issues/737). Follow-up of #568 (child #734,
[pulse-notify#45](https://github.com/lorenzh/pulse-notify/pull/45), merged). Issue review:
`.factory/work/737/issue-review.md`. Shared findings: none (`factory/findings/737` answers
`HTTP 404`). Sources read: notify clone at `f5007bfd5497035152e075d733124ca4cac87a9f` (merge of
PR #45), contract clone (2.1.0, the notify pin `9ab7e2492a2cec91789fba7c742bdba900a800a9`), the
approved `.factory/work/568/plan.md` (decisions 6 and 9, R8, notify section).

## Goal

A manual incident id that `/manual-incidents` still lists, but that notify filters out as
private (internal or draft), keeps its delivery ledger keys during retention pruning. So if the
item is later public again, its old events are not sent a second time.

## Current behavior (verified)

1. `fetchManualIncidents` (`notify/src/api.ts:283-305`) runs `continue` on every raw item for
   which `isPublicManualIncident` (`contract/src/manual-incident-public.ts:35-42`) is false
   (`api.ts:289`). No trace of a filtered item reaches `ManualIncidentsResult`
   (`api.ts:275-280`: `incidents`, `rejected`, `isAbsent`).
2. `Notifier.#poll` sets `#visibleManual = new Set(manualResult.incidents.map((i) => i.id))`
   after a successful, non-404 read (`notify/src/notifier.ts:403-407`). After a failed read or a
   404 it keeps the last value. Before the first good manual read it is `undefined`
   (`notifier.ts:198-199`).
3. `#pruneLedger` (`notifier.ts:451-463`) runs when the automatic `/incidents` read succeeds, at
   the first such poll and then at most once per `PRUNE_EVERY_MS` = 1 h (`notifier.ts:105`). It
   calls `ledger.prune(days * DAY_MS, this.#visible, this.#visibleManual)`.
4. `Ledger.prune` / `isPrunable` (`notify/src/ledger.ts:1142-1197`) keep `pending` entries and
   entries with `at >= cutoff`. They keep a `manual:<id>:` key (`MANUAL_KEY`, `ledger.ts:572`)
   when `visibleManual` is `undefined` or holds `<id>`. Every other old settled key is deleted.
5. So the defect: public incident 9 is delivered (`manual:9:opened`). The api then lists 9 with
   `visibility: "internal"`. Notify drops it, `#visibleManual` loses 9, and the next prune after
   the retention deletes `manual:9:opened`. When 9 is listed as public again, the detector sees
   no handled key and sends `opened` (and every listed update or resolved event) again.
6. `ChecksResult.listedIds` and `ComponentsResult.listedIds` (`api.ts:201-273`) already carry the
   id of every listed item, valid or not, for alert pruning (`notifier.ts:473-474`). The docs
   state that rule (`docs/operation.md:14`). `safeId` (`api.ts:53-58`) reads a raw numeric id
   from its own data property descriptor and keeps only a safe integer. The contract `integer`
   for a manual incident id is `z.int()` (`contract/src/schema.ts:44`), so every accepted id is
   also a safe integer.
7. The api clone has no `visibility` or `publishedAt` yet (`grep -rn visibility api/src` prints
   nothing outside tests). Today a filtered item can only come from a newer api with a bug or a
   manual database edit, as the issue says.

## Scope

- notify only: `src/api.ts` (presence ids in the manual fetch result), `src/notifier.ts` (prune
  presence from those ids), tests, and docs (`docs/operation.md`, `README.md` if its retention or
  privacy wording needs it).

## Non-goals

- No change to what is sent. Drafts and internal items are still never sent, and no new event
  type, recall or purge is added. Decision 6 of #568 (visibility is fixed at publication) stays
  the supported policy.
- No ledger format change. Format stays 4 (`ledger.ts:31`). Keys, timestamps, the `prune`
  signature and the hourly cadence stay the same.
- No change to automatic `/incidents` pruning or validation, alert-state pruning, retry, resend
  or the at-least-once crash semantics.
- No protection for an item that the api omits from the feed. Notify cannot tell "omitted" from
  "deleted". An api that drops a published incident from its public feed after the retention
  can still cause a resend. This is outside this issue.
- No contract, api, status, config or deploy change.

## Decisions

1. **Presence is "listed", not "accepted".** `ManualIncidentsResult` gets
   `listedIds: Set<number>`: the id of each accepted incident plus the `safeId` of every other
   item in the successful array. That covers items filtered as private, items rejected as
   malformed, and items without usable privacy fields. This follows the `listedIds` pattern of
   `/checks` and `/components` and the documented alert rule "an item that is listed but fails
   validation still counts as present". Extra effect, on purpose: a listed public item that fails
   validation also keeps its old keys. This is safer than today, where it loses them and would
   be resent once it becomes valid again. Its rejection, warning log and
   `pulse_notify_skipped_items_total` behavior do not change.
2. **Presence carries only the id.** Notify reads the id with the existing `safeId`: own data
   property, `typeof === "number"`, `Number.isSafeInteger`, no coercion, no getter. An item
   without a usable id adds nothing. No other field of a private item is read, kept, logged or
   counted. A private item does not need to pass `validateManualIncident` to add its id.
3. **Presence never creates keys.** `listedIds` feeds only `#visibleManual` (prune protection).
   Seeding (`#seedChannel`), manual detection (`#pollManual`), routing and payloads still use
   `incidents` alone. A draft that notify has never sent gets no key from being listed. It is
   announced once when it is published.
4. **Last-good-read semantics stay.** On a successful non-404 read,
   `#visibleManual = manualResult.listedIds`. That set replaces the old one and is not merged
   with it. On a 404 or a failed read, `#visibleManual` keeps the last value. Before any good
   read it stays `undefined`, so every manual key is kept. A successful empty array means
   absence: old settled keys can be pruned again.
5. **Ledger unchanged.** `Ledger.prune(maxAgeMs, visible, visibleManual)` already takes a
   presence set. It now gets a larger set, and `ledger.ts` does not change.

## Required behavior

- R1: An id listed in a successful `/manual-incidents` array (public, internal, draft or
  malformed, with a safe integer `id`) keeps all its settled `manual:<id>:` keys (opened, update,
  resolved), however old, until a successful read no longer lists it.
- R2: An id absent from the last successful manual array loses its settled keys once they are
  older than `PULSE_NOTIFY_STATE_RETENTION_DAYS`, at the next eligible hourly prune. This is the
  same as today.
- R3: The #568 rules hold. A private item is not in `rejected` or `incidents`. It produces no
  log line, does not raise `pulse_notify_skipped_items_total{feed="manual-incidents"}`, and
  sends nothing on any channel. Accepted incidents are `publicManualIncident` projections. An
  older-api item without `visibility`/`publishedAt` is public as before.
- R4: Republishing a delivered incident with unchanged events after an internal or draft phase
  that lasted past the retention sends nothing new. A truly new public event, such as a new
  update, is still sent once.

## Performance impact

The metrics of `api/bench/budgets.json` (`startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`,
`peak_rss_mib`, `test_cpu_s`, and the reported `startup_wall_ms`, p95 latencies, requests per
second, image size) measure pulse-api. This change touches only notify, so none expected. The
api is not rebuilt or changed. Inside notify the extra work is one descriptor read per listed
manual item per poll and one `Set<number>` of the same size. Both are bounded by the
response cap `PULSE_NOTIFY_API_MAX_BYTES`, and the change adds no I/O. The implementer does not
run an api bench.

## Security impact

Security impact: yes. The change reads a new field (`id`) from untrusted, private items of the api
feed at notify's input boundary. Before, these items were dropped unread, and they are private by
definition.

Checklist items that apply:
- **Input validation:** the id is accepted only as an own data property that is a safe integer.
  Strings (`"7"`), floats (`7.5`), `2 ** 53`, arrays and objects add
  nothing. No `Number()` coercion.
- **Accessor execution:** the id is read through `Object.getOwnPropertyDescriptor(...).value`
  (`safeId`). No getter runs. JSON input has none, but the helper must stay descriptor-based.
- **Secrets in errors, logs and responses:** no title, message, note, draft, visibility or
  `publishedAt` of a private item reaches a log line, a metric label, `/metrics`, a channel
  payload or the ledger. A private item's id reaches only the in-memory prune presence set.
  It must not appear in a log line either (no "kept because private" log).
- **Body and size limits:** unchanged. The existing `maxBytes` bounds the array and so the set.

Not touched: admin routes or auth, probe HTTP client, file writes (ledger rows are only kept
longer, never written differently), dependencies, Dockerfile, CI.

## Rollout order

One repository: only notify changes. It keeps its contract pin `9ab7e249…` (2.1.0) and its
kit and config pins. It works with every api version:
- An api without `/manual-incidents` (404): `isAbsent`, `#visibleManual` unchanged. Same as
  today.
- An api without privacy fields (the current api clone): every item is public, and `listedIds`
  equals the accepted ids plus any malformed listed ids. For valid feeds pruning is the same as
  today.
- An api with privacy fields: filtered items now protect their keys (the fix).
No migration. The first prune after the upgrade runs with the new, larger presence set and so
removes no more than before.

## Counterexamples

Rule R1/decision 1 (listed id protects keys):
- C1: `manual:9:opened` delivered at T0, retention 1 day. At T0 + 2 days the feed lists
  `{ id: 9, visibility: "internal", ... }`, and a prune runs. A correct build keeps the key. Notify
  `main` deletes it (the defect). An implementation that protects only `incidents` ids fails.
- C2: the same with `publishedAt: null` (draft) instead of internal. The key must be kept.
- C3: the internal item has `title` missing (not a valid `ManualIncident`) but `id: 9`. The key must
  be kept. An implementation that validates private items first and drops invalid ones fails.
- C4: incident 9 had `opened`, `update:<hash>` and `resolved` keys delivered. All three must
  stay, not only `opened`.

Rule decision 2 (safe id only):
- C5: a private item with `id: "9"` (string) does not protect `manual:9:*`. An implementation
  that coerces with `Number()` fails. Same for `id: 9.5` and `id: 9007199254740992`
  (`2 ** 53`), and for an item without `id`.

Rule decision 3 (presence never creates keys):
- C6: draft 12 is listed privately at first start and in later polls, then published. Exactly one
  `manual:12:opened` per eligible channel. An implementation that seeds listed ids (marks
  them handled) sends nothing, so it fails.
- C7: a poll that lists only private items creates no ledger entry for them:
  `ledger.has(<ch>, "manual:12:opened")` is `false` before publication.

Rule decision 4 (replace, not merge; failures keep last good):
- C8: after C1, a successful `[]` manual read at T0 + 4 days, then an eligible prune: `manual:9:opened`
  is deleted. An implementation that merges sets or keeps tombstones fails.
- C9: after C1, the manual feed answers `500` (or `404`) while `/incidents` succeeds, and an eligible
  prune runs: `manual:9:opened` stays. An implementation that sets an empty set on failure
  fails.
- C10: before any good manual read (feed failing from start), no `manual:` key is pruned. This is
  the same as today, see `test/feeds.test.ts:159`.

Rule R2 (pruning still works): a control key `manual:50:opened` (settled, `at` older than the
retention, id 50 never listed) is deleted by the same prune that keeps `manual:9:opened`. This
proves the prune ran. Without that control a test that keeps every key would pass vacuously.

Rule R3 (privacy and normal sending):
- C11: a poll of only private items leaves
  `pulse_notify_skipped_items_total{feed="manual-incidents"}` at `0` and logs no warning. A
  malformed public item (missing `title`) in the next poll raises it to `1` (both literals).
- C12: `fetchManualIncidents` on `[internal 1, draft 2, public 4 with notes, public 5 missing title,
  private { visibility: "internal", id: "6" }]` returns `rejected` =
  `[{ index: 3, id: 5, reason: "invalid" }]`, `incidents` = `[manualIncident({ id: 4 })]` (no
  notes/draft), and `listedIds` = `{1, 2, 4, 5}` (6 is a string, so it is left out).

Retention timing (unchanged, stated exactly): an entry is prunable when its status is not
`pending` and `entry.at < now - PULSE_NOTIFY_STATE_RETENTION_DAYS * 86_400_000` ms (strictly
older). Prunes run at the first poll whose `/incidents` read succeeds, then at the first such
poll at least 3_600_000 ms after the previous prune. There are no statistics in this spec.

## Contract fields

New name: `listedIds` on notify's own `ManualIncidentsResult` (`notify/src/api.ts`). It is a
notify-internal TypeScript interface, not a contract or wire field. It reuses the name of the
existing notify fields `ChecksResult.listedIds` and `ComponentsResult.listedIds`
(`api.ts:207`, `api.ts:256`) on purpose and has the same meaning. Collision search:

```
$ grep -rn 'listedIds' .repos/contract/src .repos/config
(no output)
$ grep -rn 'listedIds' .repos/notify/src
notify/src/notifier.ts:473, :474; notify/src/api.ts:207, :226, :231, :256, :264, :267, :272
```

No route, metric, env var, config key, ledger key or contract field is added or renamed.

## Repository: notify

Files:
- `src/api.ts`
- `src/notifier.ts`
- `test/manual-flip.test.ts` (new)
- `test/api.test.ts`
- `test/manual-incidents.test.ts`
- `docs/operation.md`
- `README.md`

Behavior change: yes. Ledger keys of listed private manual incidents survive retention pruning,
so a republished incident is not sent again.

What each file gets:
- `src/api.ts`: `ManualIncidentsResult` gets `listedIds: Set<number>` with a doc comment ("the
  id of every listed item, public or not, valid or not: a listed incident keeps its ledger
  keys"). `fetchManualIncidents` adds `safeId(raw)` (when defined) for every item before the
  privacy guard, and the id of each accepted incident. The 404 result has an empty set. Reuse
  `safeId` (`api.ts:53-58`) and do not add a second id reader. The privacy guard stays before
  validation, and a skipped private item is still neither rejected nor logged.
- `src/notifier.ts`: on a successful non-404 manual read,
  `this.#visibleManual = manualResult.listedIds` (replacing `notifier.ts:406`). Update the field
  comment at `notifier.ts:198` ("ids listed by the last successful read, private or invalid
  ones too; kept on 404 or a failed read"). Nothing else reads `listedIds`.
- `test/manual-flip.test.ts`: the regression (acceptance 1 and 2 below). The issue's review
  called it `flip.test.ts`, and the `manual-` prefix matches the other manual test files. It
  uses the patterns of `test/prune.test.ts` (one `clock` injected into `Ledger` and `Notifier`,
  `stateRetentionDays`) and `test/manual-incidents.test.ts` (`api.raw` serving raw items, `poll`
  = `tick()` + `idle()`, file channels, `manualIncident` from `test/support.ts:250`).
- `test/api.test.ts`: extend the private-item case at `test/api.test.ts:201` with `listedIds`
  (C12).
- `test/manual-incidents.test.ts`: only if a needed case (C6/C7) is not already covered there.
  The existing tests at `:245`, `:267` and `:283` must pass unchanged.
- `docs/operation.md:13` (Retention): add that a manual incident id listed by the last successful
  `/manual-incidents` read keeps its keys even when notify skips the item as a draft, internal or
  malformed. Its content is never sent. An item that the api omits is not protected.
- `README.md`: change only if its manual-incident or retention wording becomes wrong. The
  current intro (`README.md:5`) needs no change unless the implementer finds a retention
  statement elsewhere.

Checks (tool facts verified in files):
- Bun `1.4.0`: `package.json:9` (`engines`) and `package.json:35` (`packageManager`). The CI
  setup uses `bun-version: 1.4.0` in the shared `check.yml` at the pinned
  `04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`.
- `bun run check` = `bun run lint && bun run typecheck && bun run test` (`package.json:17`).
  lint = `biome check . && pulse-eslint . && pulse-workflows` (`package.json:14`). typecheck =
  `bun node_modules/typescript7/bin/tsc --noEmit` (`package.json:12`). test = `bun test`
  (`package.json:13`).
- Coverage: `bunfig.toml:1-4`, `[test] coverage = true`, `coverageThreshold = { lines = 0.8,
  functions = 0 }`. Never lower it. ESLint cognitive complexity 15 per function (notify
  `AGENTS.md`, Tests).
- Biome `2.6.3` (`package.json:21`). `biome.json:2` extends `@lorenzh/pulse-config/biome.json`,
  pinned to `04108fa0…` (`package.json:22`). The pinned `biome.json` matches the config clone
  (`main` `bc870498…`) byte for byte (checked with `gh api …?ref=04108fa…`). Its `includes`
  list starts at config `biome.json:10`.
- CI: `.github/workflows/ci.yml:18` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@04108fa0…`. The pinned file is identical to
  the clone. Its steps are install `--frozen-lockfile`, `bun run lint`, `bun run typecheck`,
  `bun run test`. Build is only with `inputs.build`, which notify does not set.

Acceptance (every expected value is a literal written in the test):
1. **Regression, internal flip** (`test/manual-flip.test.ts`). Setup: `clock = START`, one
   `Ledger` and one `Notifier` with `now: () => clock`, `stateRetentionDays: 1`, two file channels
   (`all` catch-all, `web` filtered to the incident's component). `/incidents` = `[]`,
   `/checks` = one check. Seed a control: the ledger holds a settled `manual:50:opened` with `at =
   START` (via `ledger.seed`, before the notifier starts, so it is old and never listed).
   - Poll 1: manual `[]`. Poll 2: public incident 9 (fixed `createdAt`, one update). Each channel
     holds exactly `["manual:9:opened"]`.
   - Serve 9 as `{ ...same, visibility: "internal", publishedAt: <fixed> }`. Set
     `clock = START + 3 * DAY`, then poll. That passes the retention (1 day) and the hourly prune
     gate. Assert `ledger.has("all", "manual:9:opened") === true`, the same for `web`, and
     `ledger.has("all", "manual:50:opened") === false` (the prune ran).
   - Serve 9 public again with identical event data. Poll. Each channel holds exactly
     `["manual:9:opened"]` (1 line in total, not 2).
   - On notify `main` at `f5007bf…` this test fails on the `has(... "manual:9:opened") === true`
     assertion (or on the line count, 2 instead of 1). The PR shows that failing run, then the
     passing run. A coverage-only failure does not count.
2. **Draft flip and all keys**: the same with `publishedAt: null` instead of `internal`, for an
   incident with an update and a resolution delivered before the flip. After republication each
   channel still holds exactly its 3 earlier lines (opened, update, resolved) and no new line.
   Also: once that id is absent from a successful `[]` read and a later eligible prune runs (+2
   days, past the hour), its keys are gone (C8). A manual feed `500` in place of `[]` keeps them
   (C9).
3. **Restart**: after the private poll past the retention, `stop()` the notifier and open a new
   `Notifier` on the same ledger path. Then serve 9 public again: 0 new lines.
4. **Private item never seeded** (C6, C7): an id listed only as a draft has no key
   (`ledger.has` is `false`). After publication each channel holds exactly 1
   `manual:<id>:opened`.
5. **Fetch boundary** (C12) in `test/api.test.ts`: the literal `rejected`, `incidents` and
   `listedIds` values above.
6. **Unchanged behavior**: the existing tests `test/manual-incidents.test.ts:245`, `:267`, `:283`
   (skipped-items metric `0` then `1`), `test/feeds.test.ts:159` and `test/prune.test.ts` pass
   without edits to their assertions.
7. `bun run check` passes.
8. Smoke (notify `AGENTS.md`, End-to-end checks): run `bun run start` with `PULSE_NOTIFY_CONFIG`
   pointing at a file channel and `PULSE_API_URL` at a local fake api that serves one public
   manual incident and then the same id as internal. Report the command and that exactly one
   line is written. The retention expiry itself is shown only by the injected-clock test, not by
   waiting in real time.

Completion evidence: PR names #737, links the failing run of acceptance 1 on `f5007bf…` and the
passing run, the `bun run check` output and the smoke command. It states the known limit: an
item that the api omits from the feed is not protected.

## Risks

- **Over-retention:** ids of malformed or private listed items now keep their keys. These are
  bounded by the feed itself (an item drops out when the api stops listing it), and their keys
  are small rows. This is wanted (decision 1).
- **A wrong id gets protection:** a hostile or buggy api can list any integer id and keep that
  key alive. The worst effect is a ledger row kept longer, never a send. This is the same trust
  as today's public feed.
- **Item omitted, not filtered:** not covered (non-goal). The docs say so.
- **Test vacuity:** without the pruned control key, a test that never prunes would pass. The
  control is required in acceptance 1.
