# Spec #815: contract patch, notify channel validators match notify's rules

## Goal

Contract 2.4.0 (pulse-contract PR #52, merge `c5ce6685ce8b563a243823bca451032291b81adb`, feature
#570, child #806) added the notify channel, report and failed-view validators. Three of them accept
or refuse input differently from notify's own rules, one admin view accepts a contradiction, and the
docs miss two exported types. A contract patch release fixes these five points. The services that
build on 2.4.0 (api, console, status, notify; owner decision in the last owner comment on #570:
"Child builds for api, status, notify and console use 2.4.0 now and bump the pin when 2.4.1 is
released; notify keeps its own existing rules") then bump their contract pin.

### Version: 2.5.1, not 2.4.1 (change since the previous run of this spec)

Since the previous run, contract `main` moved to `b637302363b3f147a99280e5961396e6c9f22e7a`
(PR #53, feature #573, child #818), version `2.5.0`. The issue asks for "2.4.1 (patch)", written
when `main` was `2.4.0`. Consumers pin a commit on contract `main` only (contract `README.md:17`
"Depend on a pinned commit of `main`"; `docs/index.md:739-740`), so a 2.4.1 branch beside `main`
is not usable, and setting `package.json` `version` from `2.5.0` back to `2.4.1` on `main` would
make the version go backwards. The patch therefore takes **the next patch version after the
version on contract `main` when it merges: `2.5.1` on today's `main` (`2.5.0`)**. This is the same
rule the approved #573 spec used for its minor (`.factory/work/573/plan.md:314-316`, D13). If
another patch merges first (open issue #823 asks for a docs-only contract patch), this change takes
the next free patch number (for example `2.5.2`); the implementer states the literal it used in the
PR. Everything else the issue says about "2.4.1" applies unchanged to this patch: a patch, wire
version 1, every service built on 2.4.0 takes it as a pin bump. The 2.5.0 additions
(subscriptions) are additive (`.factory/work/573/plan.md:1386-1389`), so a consumer that moves
from `c5ce668` to the patch commit gets them without any change of its own.

Inputs read for this spec: issue #815 and its comments (including the plan-review findings of the
previous run), `.factory/work/815/issue-review.md`, the #570 spec (`.factory/work/570/plan.md`, R1
at lines 716-860), the #573 spec (D13), issues #809, #810, #811, #818-#823, and the clones of
contract (`b637302`), notify (`0464b90`), api (`b6f1d53`), console (`c0699b7`), status
(`d602c94`), config (`bc87049`). Shared findings:
`gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/815` answered HTTP 404, so there
are no findings yet. The `main` SHAs of all five repositories were rechecked in this run
(`gh api repos/lorenzh/pulse-<repo>/commits/main`) and equal the clones.

### Changes in this run (plan-review of the previous run)

1. Rollout order: R2 also *accepts* one new input set (the space-padded address), which an old
   console refuses for the whole admin view and an old notify refuses as an element (and in its
   ledger, at start). The rollout is now readers first, writer last: console and notify bump
   before api; `targets.json` makes api depend on console and notify; the api child checks both
   reader pins before editing; literal mixed-version checks M1-M4, a rollback rule and a deploy
   rule are added (Rollout order).
2. Performance impact: the contract's single export eagerly loads the 2.5.0 subscription modules
   (`dist/index.js:11`, `:18`), so the pin move costs api and notify startup CPU and memory. It was
   measured in this run (+1.4 ms import CPU, +0.08 MiB RSS), every budget key now has an expected
   change, and test CPU is measured as CPU (user + system of `bun run test`), not wall time.

## Evidence of the defects (run in this plan state)

`gh api repos/lorenzh/pulse-contract/compare/c5ce668...b637302` lists the files 2.5.0 changed;
`src/notify-channels.ts` is not among them, so 2.4.0 and 2.5.0 validate notify channels, reports and
failed views identically. "Fails on 2.4.0" below means fails on `c5ce668` and equally on `b637302`.

Both sides ran under Bun with zod 4.6.7 (the exact version of contract `package.json:39` and of
notify `package.json`), from copies of the clone sources in a scratch directory: notify `0464b90`
`channelSchema("email")` of `src/channel-schema.ts` and contract `b637302` public validators.

Zod 4.6.7 string `.max()` counts code points, not UTF-16 units:
`package/v4/core/checks.js:271-273` of the published `zod@4.6.7` tarball
(`const length = typeof input === "string" && units > def.maximum ? util.codePointLength(input) : units;`).
So R1's sentence "every length is JavaScript `string.length` (UTF-16 code units), which is what the
contract's zod `.max()` counts" (`.factory/work/570/plan.md:783-784`) is wrong about Zod.

Base email channel
`{id:"mail", type:"email", smtp:{host:"smtp.test", port:587}, from:"pulse@x.test", to:["ops@x.test"]}`,
one field varied (every address row was run for `from` and for `to[0]` with the same result):

| Input | notify 0464b90 | contract 2.4.0 / 2.5.0 |
| --- | --- | --- |
| `from`/`to[0]` = `Ops <ops@example.test>` | accept | accept |
| `from`/`to[0]` = `Ops < ops@example.test >` | accept | **reject** |
| `from`/`to[0]` = `Ops <ops@example.test> trailing` | reject | **accept** |
| `from`/`to[0]` = `  ops@example.test  ` | accept | accept |
| `from`/`to[0]` = `Ops <ops@example.test>  ` | accept | accept |
| `from`/`to[0]` = `ops@example.test\r\n` | reject | reject |
| `from`/`to[0]` = `Ops <>` | reject | reject |
| `smtp.clientName` = `pulse.example.test` | accept | accept |
| `smtp.clientName` = `[192.0.2.1]` | accept | accept |
| `smtp.clientName` = `[IPv6:2001:db8::1]` | accept | accept |
| `smtp.clientName` = `localhost` | accept | accept |
| `smtp.clientName` = `pulse_console` | reject | **accept** |
| `smtp.clientName` = `pülse.example.test` | reject | **accept** |
| `smtp.clientName` = `pulse\u0000.example.test` (a real NUL) | reject | **accept** |
| `smtp.clientName` = `-pulse.test` | reject | **accept** |
| `smtp.clientName` = `pulse..test` | reject | **accept** |
| `smtp.clientName` = `pulse.example.test.` | reject | **accept** |
| `smtp.clientName` = `[]` | reject | **accept** |
| `smtp.clientName` = `"x".repeat(64)` | reject | **accept** |
| `smtp.clientName` = `""` | reject | reject |
| `smtp.clientName` = `a b` | reject | reject |

Contract 2.5.0, other points (report base
`{at:1, startedAt:1, appliedRevision:null, fileChannels:[{source:"file", id:"f", type:"file", refs:[<ref>]}], fileChannelsTotal:1, shadowedIds:[], rejected:[], failed:[], failedTotal:0}`):

| Input | R1 / issue | contract 2.4.0 / 2.5.0 |
| --- | --- | --- |
| report `fileChannels[0].refs[0]` = `"😀".repeat(100)` (200 units) | accept | accept |
| report `fileChannels[0].refs[0]` = `"😀".repeat(101)` (202 units) | reject | **accept** |
| report `fileChannels[0].refs[0]` = `"a".repeat(199) + "😀"` (201 units) | reject | **accept** |
| failed view `{state:"never", receivedAt:null, failed:[entry], failedTotal:1}` | reject | **accept** |
| failed view `{state:"never", receivedAt:null, failed:[], failedTotal:3}` | reject | **accept** |
| failed view `{state:"never", receivedAt:null, failed:[], failedTotal:0}` | accept | accept |

(`entry` = `{channelId:"mail", key:"1:opened", event:"opened", isManual:false, failedAt:1, hasPayload:true}`.)

Old-reader messages for the padded address, run in this plan state on `b637302`'s published
`dist/` (same notify code as 2.4.0): `validateNotifyChannelDefinition` of the base channel with
`from: "Ops < ops@example.test >"` gives `channel.from: must hold an email address`;
`validateNotifyChannelRecord(record, "channels[0]")` gives
`channels[0].from: must hold an email address`; the envelope
`{revision:` `` `sha256-${"1".repeat(64)}` `` `, channels:[record]}` passes
`validateServiceNotifyChannels` (the envelope checks ids only).

Notify's reference rules at `0464b90` (unchanged since `c79f0b7`: the compare
`c79f0b7...0464b90` does not list `src/channels/mailer.ts`, and its `src/channel-schema.ts` patch
touches only the webhook schema). Copied here because the contract build context holds only meta
and config (`.factory/config.yaml:77`):

```ts
// src/channels/mailer.ts:6-23
const HOST_LABEL = /^[A-Za-z0-9-]{1,63}$/;
const LITERAL_BODY = /^[0-9A-Fa-f:.]+$/;
function isAddressLiteral(value: string): boolean {
  if (!value.startsWith("[") || !value.endsWith("]")) return false;
  return LITERAL_BODY.test(value.slice(1, -1).replace(/^IPv6:/, ""));
}
function isHostName(value: string): boolean {
  return value
    .split(".")
    .every((label) => HOST_LABEL.test(label) && !label.startsWith("-") && !label.endsWith("-"));
}
export function isEhloName(value: string): boolean {
  return value.length <= 255 && (isHostName(value) || isAddressLiteral(value));
}
// src/channels/mailer.ts:35-38
export function envelopeAddress(value: string): string {
  const match = /<([^<>]*)>\s*$/.exec(value);
  return (match?.[1] ?? value).trim();
}
// src/channel-schema.ts:32-39: address = trimmed text not empty, no CR/LF, and
// /^[^\s<>@]+@[^\s<>@]+$/.test(envelopeAddress(v)); src/channel-schema.ts:125-127: clientName
// refines isEhloName (notify's own message "smtp.clientName must be a host name or an address
// literal"; the contract keeps its message, see R3).
```

Notify already cuts report text in UTF-16 units, as R1 wants: `cutText` in
`src/remote-channels.ts:21-27` compares `text.length` and does not split a surrogate pair;
`src/service-report.ts:11-14` uses the limits 200/200/300/300 and `:113` drops failed entries whose
`channelId` or `key` is over the limit by `.length`.

## Scope

1. Notify report text lengths count UTF-16 code units (`string.length`) in the six report text
   positions of contract `src/notify-channels.ts` that use `viewText` (`:345-349`): file view `id`
   (1..200), each file view `refs` entry (1..200), rejected `channelId` (1..200, or `null`), rejected
   `reason` (1..300), failed `channelId` (1..200), failed `key` (1..300). They apply wherever these
   schemas are reused: `validateNotifyServiceReport`, `validateAdminNotifyChannelsView` (through
   `service.report`), `validateAdminNotifyFailedView` (through `failed`).
2. Email addresses (`from` and every `to` entry, shared schema `address`,
   `src/notify-channels.ts:99-107`) use notify's anchored extraction and trimming.
3. `smtp.clientName` (`src/notify-channels.ts:161-163`) uses notify's `isEhloName` predicate in
   addition to the existing 200 code-point `text` cap.
4. `validateAdminNotifyFailedView` (`src/notify-channels.ts:481-496`): state `never` requires
   `failed: []` and `failedTotal: 0`.
5. `docs/index.md` lists `NotifyFailedEvent` and `ResendCommandState`, and states the corrected
   rules.
6. Version: next patch after `main` (2.5.1 today), `WIRE_VERSION` 1, `dist/` rebuilt.
7. Pin bumps in console, status, notify and then api to the merged patch commit, with a test per
   consumer where the consumer runs a changed validator, and literal mixed-version checks for the
   one input the patch newly accepts (Rollout order).

## Non-goals

- No other string limit changes its counting. The routing lists (`text`, 200 code points,
  `src/notify-channels.ts:85-87`), `statusUrl`, status settings, status reports, subscriptions and
  the resend shapes (`src/resend.ts:52-55`) keep Zod's code-point counting. The docs say so (see
  contract section); making them count UTF-16 units is a separate issue if wanted.
- No change to channel ids, secret references, byte budgets, list or count limits, error message
  texts of existing rules, the service-channel envelope (`ownId` still reads only `id`), or the
  `NotifyServiceState` rules.
- The `clientName` cap stays the contract's 200 (`text`); notify's own ceiling is 255. A name of
  201..255 characters passes notify and fails the contract. That direction is safe (the contract is
  stricter) and the issue's constraint forbids widening an existing contract bound.
- No new export, no exported helper for tests, no new dependency, no import of notify code into
  contract.
- Notify's own schemas and messages do not change (owner decision on #570).
- No change to probe (pins `7ce23aa...`, uses no notify validator), deploy, kit or website.
- The three undocumented subscription schemas are #823's job, not this one.
- Validation does not cut or normalize: a passing validator returns the same object unchanged.
  Notify cuts display text before it reports (R1 cut rule); that stays notify's job.

## Required behavior

R1. **Report text length.** For each of the six positions, a string of length `L` in UTF-16 code
units (`value.length`) passes exactly when `1 <= L <= max` (max 200 or 300 as listed in Scope 1).
The error message stays `must be 1..<max> characters`. Implement with a refinement on
`value.length`, not with Zod `.min()`/`.max()`, and only in `viewText`.

R2. **Email address.** The contract's private `envelopeAddress(value)` becomes exactly notify's:
`const match = /<([^<>]*)>\s*$/.exec(value); return (match?.[1] ?? value).trim();`. The rest of
`address` stays: `singleLine` (200 code-point cap, no CR or LF) and
`/^[^\s<>@]+@[^\s<>@]+$/` on the extracted text, error `must hold an email address`. The
validator never trims or rewrites the returned object. The doc comment above the function cites
notify `src/channels/mailer.ts` as the source rule.

R2 loosens the rule for one set of inputs and tightens it for another. The **newly accepted set**
is exactly: the text ends, after optional whitespace, in `<` + inner + `>` where inner holds no
`<` or `>`, inner itself fails `ADDRESS` and `inner.trim()` passes it; in words, an address inside
the final `<…>` with whitespace (as `String.prototype.trim` counts it) before or after it, for
example `Ops < ops@example.test >` or `<ops@example.test >`. Reason: when notify's regex matches,
its `<` is the last `<` and its `>` the last `>` of the text, so 2.4.0's `lastIndexOf` slice is the
same inner text untrimmed; when it does not match, notify uses the whole trimmed text, and every
text for which 2.4.0 took a slice holds a `<` and a `>` and fails `ADDRESS` both ways. The **newly
refused set** is a final `<…>` followed by anything but whitespace (for example
`Ops <ops@example.test> trailing`). R1 and R3 only refuse more; R4 only refuses more. So the
newly accepted address set is the only input that an old reader can refuse after a new writer
stored it. Rollout order handles both sets.

R3. **SMTP client name.** `clientName` is `text` (cap 200) refined by a private `isEhloName` that is
notify's predicate as quoted above (labels `^[A-Za-z0-9-]{1,63}$` split on `.`, no leading or
trailing `-`; or `[` + body + `]` where the body without a leading case-sensitive `IPv6:` matches
`^[0-9A-Fa-f:.]+$`; length at most 255). Error message stays `must be a host name`. Absent
`clientName` stays valid. A comment cites notify `src/channels/mailer.ts` as the source rule.

R4. **Empty never view.** In `adminNotifyFailedViewSchema.superRefine`, after the existing
`receivedAt` rule and before the existing total rule, add: when `state === "never"` and
`failed.length > 0`, an issue at `["failed"]` with message `must be empty when state is never`;
when `state === "never"` and `failedTotal !== 0`, an issue at `["failedTotal"]` with message
`must be 0 when state is never`. The validator reports the first issue, so:
- `{never, null, [entry], 1}` gives `view.failed: must be empty when state is never`;
- `{never, null, [], 3}` gives `view.failedTotal: must be 0 when state is never`;
- `{never, null, [entry], 0}` gives `view.failed: must be empty when state is never`.

R5. **Docs.** `docs/index.md`, section "Status and notify settings" (`:514-582`):
- names `NotifyFailedEvent` (one of `NOTIFY_FAILED_EVENTS`, the eight literals `opened`, `update`,
  `resolved`, `reminder`, `budget-low`, `tls-expiry`, `domain-expiry`, `unknown`) and
  `ResendCommandState` (one of `RESEND_COMMAND_STATES`, the nine literals `queued`, `claimed`,
  `admitted`, `delivered`, `failed`, `dropped`, `not-failed`, `no-payload`,
  `channel-unavailable`);
- replaces the claim "every length counts UTF-16 code units (`string.length`)" (`:520`) with a true
  statement: the six notify report text lengths count UTF-16 code units; the other text limits of
  the section count Unicode code points;
- says that `AdminNotifyFailedView` with `state: "never"` has `receivedAt: null`, `failed: []` and
  `failedTotal: 0`;
- says that `from`/`to` take the address inside a final `<…>` (only whitespace may follow it) or
  the whole text, trimmed, and that `smtp.clientName` is a host name (dot-separated labels of 1..63
  ASCII letters, digits or `-`, not starting or ending with `-`) or an address literal in `[…]`,
  at most 200 characters;
- a short note under the section intro naming the patch version (2.5.1 today): a patch that
  tightens these validators to notify's rules; wire version 1.

R6. **Release.** `package.json` `version` is the next patch after the version on `main` when the
change merges (`2.5.1` on today's `main` `2.5.0`). `WIRE_VERSION` stays `1`
(`src/version.ts`). The export list of `src/index.ts` and the dependency set of `package.json` are
unchanged. `dist/` is rebuilt and committed.

R7. **Consumers.** console, status, notify and api pin `@lorenzh/pulse-contract` to the full
40-character SHA of the pulse-contract `main` commit that contains R1-R6, in `package.json` and
`bun.lock`, following contract `docs/index.md` "Bump the pin in a consumer" (`:737-747`). api, the
only service that stores database notify channels, merges its bump **last**, after console and
notify (Rollout order).

## Performance impact

Keys of api `bench/budgets.json` (services api, status, notify, contract; console has no key,
api `bench/README.md:7-13`) and what the change can do to them.

**Two sources of change.**
1. *The pin move itself.* api and notify move from `c5ce668` (2.4.0) to the patch commit, which
   also contains 2.5.0. The contract package has one export, `.` -> `dist/index.js` (contract
   `package.json:11-16`), and `dist/index.js:11` and `:18` re-export `./subscriptions.js` and
   `./validate-subscriptions.js` eagerly. So every process that imports the contract now also
   evaluates those two modules at startup, including their top-level Zod schemas, whether or not
   it calls a subscription validator. Status already pins `b637302` (2.5.0), so for status this
   part is zero; for notify it is zero if #820 (bump to `b637302`) merged first.
2. *The patch code.* A few lines more in `dist/notify-channels.js` (two small private functions,
   two refinements). Evaluated once at import; per call one `.length` comparison and one anchored
   regex on a string capped at 200 or 300 characters.

**Measured in this plan run** (startup part of source 1): Bun 1.4.0, zod 4.6.7, the published
`dist/` of `c5ce668` and of `b637302` from `gh api repos/lorenzh/pulse-contract/tarball/<sha>`,
one fresh `bun` process per sample that runs `await import(<contract>)` and prints
`process.cpuUsage()` (user + system) around the import and `process.memoryUsage().rss` after
`Bun.gc(true)`; 30 samples per side, alternating A, B; median of each side (mean of the 15th and
16th smallest of 30) on a 4-core hosted runner:

| Side | import CPU (median) | RSS after import (median) |
| --- | --- | --- |
| 2.4.0 `c5ce668` | 69.20 ms | 42.38 MiB |
| 2.5.0 `b637302` | 70.58 ms | 42.46 MiB |
| difference | +1.4 ms (+2 %) | +0.08 MiB |

**Expected change per key** (direction, rough size; regression rule
`B - A > max(10 % of A, floor)`, floors `ms` 30, `s` 0.2, `MiB` 3, api `bench/README.md:108`):

| Key | Expected change | Why |
| --- | --- | --- |
| `api.startup_cpu_ms` (budget 325) | up about 1-2 ms | source 1 (+1.4 ms measured) plus source 2 (well under 1 ms) |
| `notify.startup_cpu_ms` (455) | up about 1-2 ms, 0 if #820 merged first | same |
| `status.startup_cpu_ms` (377) | none (< 0.5 ms) | already on 2.5.0; source 2 only |
| `api/notify .idle_rss_mib` (88/86), `.peak_rss_mib` (115/86) | up about 0.1 MiB | measured +0.08 MiB of module and schema objects |
| `status.*_rss_mib` | none | already on 2.5.0 |
| `api/notify .startup_wall_ms` (reported) | up about 1-2 ms | follows startup CPU |
| `api/notify/status .image_mb` (reported) | up about 0.01 MB | `dist/subscriptions.js` 4291 B, `dist/validate-subscriptions.js` 844 B, their `.d.ts`, a few hundred bytes of patch code |
| `api/notify/status .load_cpu_s` | none measurable | the bench writes 5 webhook channels once at setup (api `bench/runtime-fixture.ts:168-180`, no email so R2/R3 never run) and sends 2 notify reports per 60 s window (`bench/runtime-traffic.ts:14-20`); R1 swaps a Zod length check for a `.length` comparison on those 2 reports |
| `api.p95_*`, `api.rps`, `api.cold_*`, `api.eod_*` | none | these routes never call a notify validator |
| `contract.test_cpu_s` (9.0, floor 2) | up about 0.1 s | about 80 new validator calls of well under 1 ms each, plus two 100 000-character hostile inputs, both linear |
| `contract.build_cpu_s` (6.4) | none (< 0.1 s) | same file count, a few more lines in one file |
| `api.test_cpu_s` (9.2, floor 1.6) | up about 0.1-0.3 s | four or five new cases in the existing real-server test file |
| `notify.test_cpu_s` (3.4, floor 1.5) | up about 0.1 s | one new test file: about 50 schema calls, one temp ledger, one `checkChannelsAnswer` |
| `status.test_cpu_s` (3.4) | none | no new test |
| `probe.*`, `kit.*`, `config.*` | none | not changed, probe keeps its pin |

Console has no budget key; its test CPU still goes up by a few new cases.

**How the implementers measure** (each states the numbers in its PR):
- *Test CPU*, every repository that adds tests (contract, api, notify, console): five runs per
  side, alternating base (`origin/main`) and branch, of `/usr/bin/time -f '%U %S' bun run test`,
  and the median of user + system seconds per side. This is the same quantity the bench records:
  user + system CPU of `bun run test` and its waited children (api `bench/measure.ts:47-71`,
  `bench/run.ts:221-222`). Wall time is not a CPU measurement and does not count.
- *Contract build CPU*: the same with `bun run build`, three runs per side.
- *Startup CPU and RSS of the pin move*, api and notify: in the service checkout, after
  `bun install` on each side, 15 alternating samples per side of
  `bun -e 'const t=process.cpuUsage(); await import("@lorenzh/pulse-contract"); const c=process.cpuUsage(t); Bun.gc(true); console.log((c.user+c.system)/1000, process.memoryUsage().rss/1048576)'`,
  median per side. The expected difference is the measured one above (about +1.4 ms, +0.1 MiB);
  a difference above 10 ms or 2 MiB is a finding to report.
- *Full A/B*, when Docker with Compose is available: api
  `bun bench/run.ts --a <api main SHA> --b <api branch SHA> --others-ref main --rounds 3`; notify
  `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref notify=<notify branch SHA> --service-tokens --expect-report notify --rounds 3`
  (api `bench/README.md:76-100`). Without Docker the nightly bench on `main`
  (`.github/workflows/bench.yml`, api `bench/README.md:3`) is the gating check after merge; the PR
  says which of the two applies.

## Security impact

Security impact: yes. The change edits validators at a trust boundary (contract) and bumps a
dependency pin in four services.

Checklist items that apply:
- **Input validation**: R1-R4 tighten accepted input; nothing is loosened except the
  newly accepted address set of R2 (`Ops < a@b >`), which notify already accepts and which still
  yields a plain `local@domain` envelope after trimming. Because an old reader refuses it, api
  (the only writer) merges last (Rollout order), and the mixed-version checks of the console,
  notify and api sections prove each side with literals. Validators never throw, read own data properties only
  and never run a getter (existing guarantees, `test/runtime-getters.test.ts`,
  `test/security-adversarial.test.ts`).
- **Secrets in errors, logs and responses**: new messages are fixed text and never quote the value.
- **Body and size limits**: R1 makes the report text limits count UTF-16 units, so a stored report
  is never larger than R1 intends. The regex of R2 and the predicate of R3 run in linear time; the
  hostile-input state checks a 100 000-character address of `<` and `a` and a 100 000-character
  `clientName` of `.` and `[` (both rejected, under 50 ms each in `bun test`).
- **Dependency pins**: consumers pin a full 40-character SHA on contract `main`, `bun.lock` matches,
  `bun install --frozen-lockfile` passes in CI (pinned `check.yml`, see repository sections).

## Rollout order

Merge and release order: contract; then console, status and notify; then api last. The reason is
below.

### Who writes and who reads a stored channel

The patch changes what can be **stored**, so the order is set by the one writer and its readers:
- **Writer**: api. It is the only service that stores database notify channels: `POST` and `PUT`
  on `/admin/notify/channels[/:id]` run `validateNotifyChannelDefinition`
  (`src/notify-channel-routes.ts:134-138`) and store the validated JSON with its original
  spelling. It never re-checks a stored row on read (`recordOf`, `:123-127`, "Only validated
  definitions are stored").
- **Readers of stored channels**:
  - console: `readNotifyChannels` runs `validateAdminNotifyChannelsView` on the whole answer
    (`src/runtime-read.ts:91-103`); one bad record makes the whole read `{kind:"failed",
    failure:{kind:"invalid"}}`, so the notification page shows no channel at all.
  - notify, channel sync: `checkChannelsAnswer` runs `validateNotifyChannelRecord` per element
    (`src/remote-channels.ts:54-66`); a refused element is reported as rejected and keeps its last
    good version. An accepted one must also pass notify's local `channelSchema`
    (`rawOf`, `src/remote-channels.ts:151-166`) before notify stores it in its ledger
    (`src/channel-sync.ts:266-276`, canonical JSON with the original spelling).
  - notify, ledger: `replaceRemoteChannels` and the ledger open both re-check each stored row with
    `validateNotifyChannelDefinition` (`src/ledger.ts:509-521`, `:912-923`). At open, one bad row
    throws `ledger <path> has an unsupported format` (`:549`), and notify exits with code 2 at
    startup (`src/index.ts:146-155`, `:215-221`).
  - status and probe read no notify channel.

So any input that a **new** api stores and an **old** console or notify refuses breaks a reader.
By R2 that is exactly the newly accepted address set (`Ops < ops@example.test >`). Every other
change only refuses more, which a new reader handles (see "Rows stored before the patch" below).

### Safe activation order

Consumer pins today: api `c5ce668` (`package.json:31`), console `c5ce668` (`package.json:32`),
status `b637302` (`package.json:34`, from #819), notify `c5ce668` (`package.json:30`, from #810),
probe `7ce23aa`. Open work on the same files: #809 (status child of #570, in `implement`) and #820
(notify child of #573, in `task-review`, PR notify #48; it bumps notify to `b637302`, 2.5.0).

**Rule: readers first, writer last.** api may run the patch only where every console and notify
that reads its channels runs the patch. Until then, api's old pin refuses the newly accepted set
with 422, so no such row can exist.

1. **contract** merges R1-R6 to `main`. Nothing runs contract code by itself; every consumer keeps
   its old pin and keeps working.
2. **console**, **status** and **notify** bump the pin (in parallel; status and notify each after
   their prerequisite, see below). Mixed states with the old api:
   - console new + api old: the console form now accepts `Ops < ops@example.test >`; the old api
     answers 422 `channel.from: must hold an email address` and stores nothing (mixed check M1).
     The console form refuses `Ops <ops@example.test> trailing` and `pulse_console` before
     sending. The failed view that api builds without a report is already
     `{state:"never", receivedAt:null, failed:[], failedTotal:0}` (api
     `src/notify-channel-routes.ts:211`), so a new console accepts it. Notify reports cut to R1
     limits in UTF-16 units (`cutText`, notify `src/remote-channels.ts:21-27`), so no stored report
     breaks the new console's admin view.
   - notify new + api old: the old api serves only rows that 2.4.0 accepted. The patch refuses
     some of them (R2 trailing text, R3), but notify's local rules refuse every one of those too
     (Evidence table), so notify never had them in its ledger and never ran them: the element is
     now refused one step earlier, by the contract instead of `channelSchema`;
     `test/remote-channels.smtp-name.test.ts:46-50` already allows both. Every row in an existing
     ledger was accepted by those local rules, so the new ledger check at open accepts it.
   - status needs no ordering: it reads no notify channel. It still waits for #809 (below).
   Status and notify wait for open work in the same files: status for #809, notify for #820, so
   that the bump does not race an in-flight pin or lockfile change. A person links the status child
   as "blocked by" #809 and the notify child as "blocked by" #820 after fan-out. Each child checks
   before editing (its section): the named issue is closed, `main` pins a contract commit that
   contains `c5ce668`, and that pin does not yet contain the patch commit. Otherwise it requests a
   hold (`needs-input` while the issue is open or the pin is older than `c5ce668`; a plain hold
   when the pin already contains the patch, because the behavior is already there).
3. **api** bumps last. Its child depends on contract, console and notify in `targets.json`, so
   Factory starts it only after both reader PRs are merged; before editing, it also checks that
   console `main` and notify `main` pin a contract commit that contains the patch (its section).
   Mixed states with the new api: none with an old console or notify on `main`, because both
   merged in step 2. A new api with any console or notify on the patch stores and serves
   `Ops < ops@example.test >` unchanged, and both readers accept it (mixed checks M2, M3, M4).

The cost: api waits for #820 through notify. That is accepted; api has no other reason to hurry,
because its old pin only keeps accepting inputs that notify's local rules refuse anyway.

### Mixed-version checks (literal)

Fixture `E(addr)` = database email channel
`{id:"mail", type:"email", smtp:{host:"smtp.test", port:587}, from:addr, to:["ops@example.test"]}`;
`P` = `"Ops < ops@example.test >"`, `T` = `"Ops <ops@example.test> trailing"`.
- **M1** (api, on the old pin as a baseline): `POST /admin/notify/channels` with `E(P)` answers
  422 on `c5ce668`. Recorded once in the api PR as the old behavior; the new-pin test expects 201.
- **M2** (console, `src/runtime-read.test.ts`): an admin view whose `channels` hold
  `{...E(P), createdAt:1, updatedAt:1, source:"database"}` reads as `kind: "ok"` with `from`
  equal to the literal `P`; the same view with `E(T)` reads as
  `{kind:"failed", failure:{kind:"invalid"}}`. On the old pin both fail by assertion (they give
  `invalid` and `ok`): the first is the hazard an api-first order would cause.
- **M3** (notify, `test/contract-parity.test.ts`): `checkChannelsAnswer` of a valid envelope that
  holds the record of `E(P)` gives one record and no rejection; a temp ledger takes
  `replaceRemoteChannels([{id:"mail", definition:<canonical JSON of E(P)>, revision:REV, appliedAt:1}])`
  without throwing and, after close and reopen, returns the same row (definition text equal, `from`
  equal to `P`). On the old pin, both fail by assertion (element rejected; `LedgerRowError`).
- **M4** (api, `src/server.notify-channels.test.ts`): `POST` with `E(P)` answers 201, and both
  `GET /admin/notify/channels` and `GET /service/notify/channels` return `from` equal to the
  literal `P` (original spelling, no trimming).
Expected values are the literals above; none is read from the code under test.

### Releases, deploy and rollback

- Released images do not hold notify database channels yet: at tag `v0.1.0`, api
  `src/notify-channel-routes.ts`, notify `src/remote-channels.ts` and console
  `src/runtime-read.ts` do not exist (`gh api repos/lorenzh/pulse-<repo>/contents/<path>?ref=v0.1.0`
  answers 404), and deploy pins `0.1.0` of all five services (deploy `common/services.yaml:8`,
  `:25`, `:35`, `:44`). So today a mixed state can only exist in the `dev` setup, which builds each
  service from the local checkout (deploy `dev/compose.yaml:33`, `:78`, `:89`).
- The first deploy change that moves api to a release with #570's notify channels (#811 or a later
  `scripts/bump-images.sh` run) must move console and notify in the same change to releases that
  contain this patch whenever the api release contains it. Deploy is not changed by this spec; a
  person carries this rule into that deploy change. A release of api is cut after the console and
  notify releases that contain the patch, never before.
- **Rollback** of console or notify below the patch while a new api runs: first rewrite every
  database channel whose address is in the newly accepted set to the unpadded spelling
  (`PUT /admin/notify/channels/<id>` with `Ops <ops@example.test>`), wait for notify's next sync
  (its ledger row is replaced), then roll back. Otherwise the old console shows no channels and the
  old notify refuses that channel and, if its ledger holds the row, exits 2 at start. Rolling back
  api alone is safe: old api serves stored rows without a check.

### Rows stored before the patch

A database written by an api on 2.4.0 can hold a row in the newly refused set (`T`, or a
`clientName` like `pulse_console`). After step 2 the new console shows the whole channel list as
invalid until that row is gone; notify never ran such a row (its local rules refuse it). Only `dev`
databases can hold one (no release stores channels, see above). Check in a `dev` stack before the
console bump reaches it: `GET /admin/notify/channels` and run the new
`validateAdminNotifyChannelsView` on the answer; if it fails, `PUT` a fixed definition or
`DELETE /admin/notify/channels/<id>` (api `src/notify-channel-routes.ts:78`, `PUT, DELETE`) for the
named row.

## Counterexamples

Report text length (R1), each must be **rejected** by `validateNotifyServiceReport`:
- `fileChannels[0].refs[0] = "😀".repeat(101)` (202 units): error
  `report.fileChannels[0].refs[0]: must be 1..200 characters`. A Zod `.max(200)` accepts it.
- `fileChannels[0].id = "a".repeat(199) + "😀"` (201 units).
- `rejected[0].reason = "😀".repeat(151)` (302 units); `rejected[0].channelId = "😀".repeat(101)`.
- `failed[0].channelId = "😀".repeat(101)`; `failed[0].key = "😀".repeat(151)`.
- any of the six fields `""`: still `must be 1..<max> characters`.
Must be **accepted**: `"😀".repeat(100)` and `"a".repeat(198) + "😀"` (200 units) in a 200 field;
`"😀".repeat(150)` (300 units) in `reason` and `key`; `"a".repeat(199) + "…"` (existing test).

Email address (R2), for `from` and for `to[0]`:
- reject `Ops <ops@example.test> trailing` (2.4.0 accepts it: its "last `<…>`" extraction ignores
  the trailing text);
- accept `Ops < ops@example.test >` (2.4.0 rejects it: no trimming inside the brackets);
- keep: reject `ops@example.test\r\n` (`must be a single line`), reject `Ops <>`; accept
  `  ops@example.test  ` and `Ops <ops@example.test>  `; the accepted value is the same object with
  the original spelling.

SMTP client name (R3), reject: `pulse_console`, `pülse.example.test`,
`pulse\u0000.example.test`, `-pulse.test`, `pulse..test`, `pulse.example.test.`, `[]`,
`"x".repeat(64)`, `""`, `a b`; each with `channel.smtp.clientName: must be a host name`. Accept:
`pulse.example.test`, `[192.0.2.1]`, `[IPv6:2001:db8::1]`, `localhost`, and
`"a".repeat(63) + "." + "b".repeat(63) + "." + "c".repeat(63)` (191 characters). Reject
`["a".repeat(63)] x 4 joined by "."` (255 characters: notify accepts it, the contract's 200 cap
refuses it with `must be at most 200 characters`; this documents the kept cap).

Never view (R4), reject:
- `{state:"never", receivedAt:null, failed:[entry], failedTotal:1}` (passes the old total rule,
  so only the new rule can catch it);
- `{state:"never", receivedAt:null, failed:[], failedTotal:3}`;
- `{state:"never", receivedAt:null, failed:[entry], failedTotal:0}`.
Accept: `{state:"never", receivedAt:null, failed:[], failedTotal:0}`;
`{state:"fresh", receivedAt:3, failed:[], failedTotal:0}`;
`{state:"stale", receivedAt:3, failed:[entry], failedTotal:500}` (total above a cut list).

Version (R6): `2.4.1` on a `main` that is `2.5.0` is wrong (the version goes backwards); `2.6.0`
is wrong (a patch, not a minor).

Rollout order (readers first, writer last), wrong orders that must not happen:
- api on the patch while console `main` is still on `c5ce668`: api stores
  `Ops < ops@example.test >` (201), and the old console's `readNotifyChannels` then gives
  `{kind:"failed", failure:{kind:"invalid"}}` for the whole list. The api precondition refuses
  this order.
- api on the patch while notify runs `c5ce668`: the old notify rejects that channel element
  (`channels[0].from: must hold an email address`), so the channel never sends.
- rolling notify back below the patch while its ledger holds the row `D` of check M3: the old
  notify exits 2 at start with `ledger <path> has an unsupported format`.
- a "readers first" check that only tests the tightened inputs (`trailing`, `pulse_console`) would
  miss all three: those are refused by every version that can store them.

No statistic is defined by this spec.

## Contract fields

No new names: no new export, field, key, constant or route. The two names the docs gain already
exist:
- `grep -n "NotifyFailedEvent\|ResendCommandState" .repos/contract/src/index.ts` gives
  `84:  NotifyFailedEvent,` and `106:  ResendCommandState,` (unchanged by 2.5.0, which only added
  lines after them).
- `isEhloName` stays private to `src/notify-channels.ts` (not in `src/index.ts`);
  `grep -rn "isEhloName" .repos/contract/src .repos/config` gives no match today, so the private
  name collides with nothing.
New fixed error texts: `must be empty when state is never`, `must be 0 when state is never`
(`grep -rn "when state is never" .repos/contract/src` today gives only
`must be null exactly when state is never`, `src/notify-channels.ts:486` and
`src/runtime-settings.ts:252`).

## Repository: contract

Files:
- `src/notify-channels.ts` (change)
- `test/notify-channels.test.ts` (change)
- `docs/index.md` (change)
- `package.json` (change: `version` only)
- `dist/notify-channels.js` (rebuilt; `dist/notify-channels.d.ts` only if the build changes it)

Behavior change: yes. Four validators accept or refuse different input (R1-R4).

Tool facts (verified at `b637302`):
- Bun 1.4.0: `package.json:7` (`packageManager`) and `:9` (`engines.bun`); zod `4.6.7`
  (`package.json:39`).
- `bun run check` = lint, build, typecheck, test: `package.json:28`; lint is
  `biome check . && pulse-eslint .` (`:25`), build and typecheck use `typescript7` (`:22-23`).
- `bunfig.toml` `[test]`: coverage on, line threshold 0.8 (`bunfig.toml:1-3`).
- CI: `.github/workflows/ci.yml:17` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with
  `build: true`. That pinned file (read with
  `gh api "repos/lorenzh/pulse-config/contents/.github/workflows/check.yml?ref=51e95b0..."`) is
  identical to the config clone `bc87049`; it runs `bun install --frozen-lockfile` (`:26`),
  `bun run lint` (`:28`), `bun run typecheck` (`:30`), `bun run build` (`:33`),
  `git diff --exit-code -- dist` (`:36`) and `bun run test` (`:38`).
- `test/smoke.test.ts:15-50` fails when a `dist/` file (including `notify-channels`) differs from a
  fresh build.

Behavior: R1 to R6 exactly. Tests go first (AGENTS.md "Tests (TDD)"): write the tests below, run
them on the unchanged source (branch start, `b637302` or later `main`; its
`src/notify-channels.ts` equals `c5ce668`'s, see Evidence), record the result, then implement.

Tests in `test/notify-channels.test.ts`, through the public validators only, with otherwise valid
fixtures and one field varied. Each item has **defect cases** (inputs whose result 2.4.0 gets
wrong: the bold rows of the Evidence tables and the R1/R4 rejects of the Counterexamples) and
**controls** (inputs 2.4.0 already gets right: the non-bold rows, existing rejects such as `""`
or CR/LF, and the accepts that already pass):
1. Report lengths: for each of the six positions, the 200/300-unit accept (control) and the
   202/302-unit emoji reject (defect), the mixed `"a".repeat(198) + "😀"` accept (control) and
   `"a".repeat(199) + "😀"` reject (defect) in a 200 field, and `""` reject (control); through
   `validateNotifyServiceReport`, plus one defect case each through
   `validateAdminNotifyChannelsView` (`service.report.fileChannels[0].refs[0]`) and
   `validateAdminNotifyFailedView` (`failed[0].key`). Expected errors are the literals of the
   Counterexamples section.
2. Addresses: the R2 counterexample list for `from` and for `to[0]`, through
   `validateNotifyChannelDefinition`; the `trailing` reject also through
   `validateNotifyChannelRecord` and `validateAdminNotifyChannelsView` (`channels[0]` a database
   view). An accepted input returns the same object (`Object.is`) with the original `from` text.
3. Client name: the R3 lists through `validateNotifyChannelDefinition`, `pulse_console` also through
   `validateNotifyChannelRecord` and `validateAdminNotifyChannelsView`; `clientName` absent stays
   valid (control). The NUL case uses a string that contains U+0000.
4. Never view: the three R4 rejects (defects) with the exact errors of R4, and the accepts of the
   Counterexamples (controls).
5. Release: `package.json` `version` equals the literal `"2.5.1"` (or the next free patch literal,
   see Goal; read the file in the test or check it in the PR evidence); `test/version.test.ts`
   keeps asserting `WIRE_VERSION === 1`.
6. Hostile inputs (Security impact): an address of `"<".repeat(50_000) + "a".repeat(50_000)` and a
   `clientName` of `".[".repeat(50_000)` are rejected without throwing.

Baseline rule: on the unchanged source, **every defect case** fails by assertion (a wrong
`ok`/`error` value, not a crash or a fixture error), and **every control** passes. After the change
both pass. A control that fails on the unchanged source is a broken fixture and is fixed before
implementing. Item 6 and the existing tests pass on both versions.

Expected values come from the literals of this spec; the reference booleans for R2 and R3 come
from executing notify `0464b90` (Evidence section), an independent implementation, not from the
new contract code.

Completion evidence:
- In the PR: the list of defect cases of items 1-4 with their failing assertion on the unchanged
  source, the statement that every control passed there, and the full pass after the change.
- `bun run check` passes.
- `bun run build` then `git diff --exit-code -- dist` is empty.
- `git diff origin/main -- src/index.ts` is empty and `git diff origin/main -- package.json` shows
  only the `version` line `2.5.0` -> `2.5.1` (or the next free patch).
- `grep -n "NotifyFailedEvent\|ResendCommandState" docs/index.md` shows both names.
- The R2/R3 table of the Evidence section, run against the new public
  `validateNotifyChannelDefinition`, gives the "notify 0464b90" column for every row (record the
  output in the PR).
- Performance (see Performance impact): test CPU A/B (five alternating `/usr/bin/time -f '%U %S'
  bun run test` per side, median) and build CPU A/B (three per side), numbers in the PR; expected
  about +0.1 s test CPU and no build change.

## Repository: console

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `src/notification-form.test.ts` (change: new cases)
- `src/runtime-read.test.ts` (change: new cases, mixed check M2)

Behavior change: yes. `parseChannelForm` (`src/notification-form.ts:270`) and the admin view reads
(`src/runtime-read.ts:98`, `:113`) run the changed validators. Console is a reader of stored
channels and must merge before api (Rollout order).

Tool facts (verified at `c0699b7`):
- Bun 1.4.0 (`package.json:9` `engines.bun`, `:35` `packageManager`); `bun run check` = lint,
  typecheck, test (`package.json:18`); typecheck also checks `e2e` (`package.json:13`);
  `bunfig.toml:1-3` coverage threshold lines 0.8.
- CI `ci.yml:18` uses the pinned `check.yml@04108fa...`, equal to the config clone (install frozen,
  lint, typecheck, test).
- Browser checks: `bun run check:browser` = `bun e2e/run.ts` (`package.json:19`); CI job `browser`
  (`ci.yml:291`) installs Chromium with `bunx playwright install --with-deps chromium`
  (`ci.yml:306`) and runs `bun run check:browser` (`ci.yml:308`). Locally: `bunx playwright
  install chromium` first (console `AGENTS.md:24`).
- Compose check: CI job `deploy-dev` (`ci.yml:231`) starts pulse-deploy `main`'s dev stack with
  this checkout and runs `E2E_CONSOLE_FLOW=two-factor bash e2e/console-setup.sh dev/compose.yaml`
  (`ci.yml:279`). A failure there in a step where the console follows the spec is a deploy defect:
  hold, never edit deploy (console `AGENTS.md:85`).

Behavior: R7. Pin to the full SHA of the contract merge commit with the patch (today
`c5ce668...`, `package.json:32`). No source change; the form shows the contract error as it does
today (`errors: [{ name: "id", text }]`). No precondition beyond the contract child: console has no
open work on its pin.

Tests (in `src/notification-form.test.ts`):
- `parseChannelForm` with the valid email input of the existing test but `smtp_client_name:
  "pulse_console"` gives `isOk: false` with text
  `channel.smtp.clientName: must be a host name`.
- the same with `from: "Ops <ops@example.test> trailing"` gives `isOk: false`; with
  `from: "Ops < ops@example.test >"` gives `isOk: true`.
Each of the three fails by assertion on the 2.4.0 pin and passes on the new pin. The existing
valid input (`clientName: "pulse.example.com"`, `from: "Pulse <pulse@example.com>"`,
`src/notification-form.test.ts:52`, `:54`) is the control and passes on both.

Tests (in `src/runtime-read.test.ts`, mixed check M2 of Rollout order, with the existing fake api
and `notifyChannelsView` helper):
- a channels view whose `channels` hold the database email record
  `{id:"mail", type:"email", smtp:{host:"smtp.test", port:587}, from:"Ops < ops@example.test >", to:["ops@example.test"], createdAt:1, updatedAt:1, source:"database"}`
  reads as `kind: "ok"`, and the read channel's `from` equals the literal
  `"Ops < ops@example.test >"`;
- the same view with `from: "Ops <ops@example.test> trailing"` reads as
  `{kind:"failed", failure:{kind:"invalid"}}`.
Both fail by assertion on the 2.4.0 pin (they give `invalid` and `ok`) and pass on the new pin.
The existing test "the channels view passes the admin record validator"
(`src/runtime-read.test.ts:109-117`, a webhook record) is
the control.

Completion evidence: the new cases fail with the old pin and pass with the new one;
`bun run check` passes; `bun run check:browser` passes; the CI jobs `check`, `browser` and
`deploy-dev` pass on the PR; the pin shows the new SHA in `package.json` and `bun.lock`; per
console `AGENTS.md:87`, `PULSE_API_URL=http://localhost:3000 bun start` (or the fixture console
`bun e2e/run.ts --serve`, `AGENTS.md:25`) with one email channel save using
`clientName` `pulse_console`, and the shown error, reported in the PR. Test CPU A/B as in
Performance impact (console has no budget key; report the numbers).

## Repository: status

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)

Behavior change: yes. A runtime dependency pin changes; status uses no changed validator (no
`validateNotify*` or `validateAdminNotify*` call in `src/`), so no status behavior is expected to
change, and no new test is required.

Tool facts (verified at `d602c94`):
- Bun 1.4.0 (`package.json:9` `engines.bun`, `:38` `packageManager`); `bun run check` = lint,
  typecheck, test (`package.json:19`); `bunfig.toml:1-3` coverage threshold lines 0.8.
- CI `ci.yml:18` uses the pinned `check.yml@04108fa...`, equal to the config clone.
- Accessibility checks: `bun run check:a11y` = `bun e2e/run.ts` (`package.json:18`); CI job `a11y`
  (`ci.yml:51`) installs Chromium with `bunx playwright install --with-deps chromium`
  (`ci.yml:66`) and runs `bun run check:a11y` (`ci.yml:68`).

Behavior: R7, in Rollout step 2 (status reads no notify channel, so it has no order against api).
Precondition, checked before any edit:
- #809 is closed (`gh issue view 809 --repo lorenzh/pulse-meta --json state`); if it is open,
  request a `needs-input` hold naming #809.
- status `main` pins a contract commit that contains `c5ce668` (today `b637302`,
  `package.json:34`): `gh api repos/lorenzh/pulse-contract/compare/c5ce668...<pin> --jq .status`
  is `ahead` or `identical`. Otherwise request a `needs-input` hold.
- that pin does not yet contain the patch commit:
  `gh api repos/lorenzh/pulse-contract/compare/<pin>...<patch sha> --jq .status` is `ahead`. If it
  is `identical` or `behind`, request a hold because the change is already there.

Completion evidence: `bun run check` passes on the new pin; `bun run check:a11y` passes; the CI
jobs `check` and `a11y` pass on the PR; `package.json` and `bun.lock` show the new SHA;
`git diff --name-only` lists only those two files. Performance: none expected (status already
pins 2.5.0, so the pin move adds only the patch lines); no measurement required.

## Repository: notify

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `test/contract-parity.test.ts` (new)

Behavior change: yes. A runtime dependency pin changes, and notify's channel sync and ledger
(`src/remote-channels.ts:54-66`, `src/channel-sync.ts:74`, `src/ledger.ts:513`) run the changed
contract validators. Notify's own rules (`src/channel-schema.ts`, `src/channels/mailer.ts`) do not
change. Notify is a reader of stored channels and must merge before api (Rollout order).

Tool facts (verified at `0464b90`): Bun 1.4.0 (`package.json:9` `engines.bun`, `:35`
`packageManager`); `bun run check` = lint, typecheck, test (`package.json:17`); tests live in
`test/` (for example `test/remote-channels.smtp-name.test.ts`); `bunfig.toml:1-3` coverage
threshold lines 0.8. CI `ci.yml:18` uses the pinned `check.yml@04108fa...`, equal to the config
clone; the other job is `docker` (`ci.yml:20`).

Behavior: R7, in Rollout step 2. Precondition, checked before any edit:
- #820 is closed; if it is open, request a `needs-input` hold naming #820.
- notify `main` pins a contract commit that contains `c5ce668` (today `c5ce668` itself,
  `package.json:30`; after #820 `b637302`), checked with the compare command of the status section.
  Otherwise request a `needs-input` hold.
- that pin does not yet contain the patch commit; if it does, request a hold because the change is
  already there.

Test `test/contract-parity.test.ts`: for every row of the R2/R3 table of the Evidence section,
build the base email channel with the one field varied (address rows for `from` and for `to[0]`)
and assert that `channelSchema("email")?.safeParse(input).success` (notify) equals
`validateNotifyChannelDefinition(input).ok` (contract) and equals the literal expected boolean of
the "notify 0464b90" column. The `"x".repeat(64)` and other rows are written out as literals;
the 201..255-character `clientName` case is left out (Non-goals: the contract keeps its 200 cap).
This compares two independent implementations and a literal, so it fails if either side drifts.
On the old pin, exactly the bold rows fail by assertion (contract side); the other rows are
controls and pass on both pins.

Same file, mixed check M3 of Rollout order (the stored form of the newly accepted address):
- `checkChannelsAnswer` (`src/remote-channels.ts:54`) of a valid envelope
  `{revision:<valid admin revision>, channels:[R]}` with
  `R = {id:"mail", type:"email", smtp:{host:"smtp.test", port:587}, from:"Ops < ops@example.test >", to:["ops@example.test"], createdAt:1, updatedAt:1}`
  gives `kind: "applied"`, one record with `from` equal to the literal
  `"Ops < ops@example.test >"`, and `rejected: []`.
- a ledger in a temp file (as the existing ledger tests do, for example `test/ledger.v5.test.ts`,
  revision `` `sha256-${"1".repeat(64)}` `` as its `REV_1` at `:74`) takes
  `replaceRemoteChannels([{id:"mail", definition:D, revision:REV_1, appliedAt:1}])` with the
  literal
  `D = '{"from":"Ops < ops@example.test >","id":"mail","smtp":{"host":"smtp.test","port":587},"to":["ops@example.test"],"type":"email"}'`
  without throwing; after `close()` a new `Ledger` on the same file opens and `remoteChannels()`
  returns that row with `definition` equal to `D`.
Both fail by assertion on the old pin (the element is rejected; `replaceRemoteChannels` throws
`LedgerRowError`) and pass on the new pin. They prove that a new notify reads what a new api
stores, and they document the rollback hazard of Rollout order (an old notify cannot open a ledger
that holds `D`).

Existing tests that must keep passing on the new pin: `test/remote-channels.smtp-name.test.ts`
(the `mail/invalid` client name may now be refused at element level, which the test allows at
`:46-50`) and the ledger tests.

Completion evidence: the parity test fails on the old pin (bold rows and the two M3 cases only)
and passes on the new pin; `bun run check` passes; `package.json` and `bun.lock` show the new SHA;
notify's `src/` is unchanged (`git diff --stat -- src` empty). Performance (see Performance
impact): test CPU A/B of `bun run test` and the startup import A/B, numbers in the PR; if #820
merged first the import A/B is expected to show no difference, otherwise about +1.4 ms and
+0.1 MiB.

## Repository: api

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `src/server.notify-channels.test.ts` (change: new cases, mixed check M4)

Behavior change: yes. api's channel writes (`src/notify-channel-routes.ts:135`) and the notify
report PUT (`:325`) run the changed validators: 422 for the R1-R3 rejects, and 201 for the newly
accepted address set of R2. api is the only writer of stored channels and merges last (Rollout
order).

Tool facts (verified at `b6f1d53`): Bun 1.4.0 (`package.json:9` `engines.bun`, `:35`
`packageManager`); `bun run check` = lint, typecheck, test (`package.json:20`); lint adds
`pulse-workflows`; `bunfig.toml:1-3` coverage threshold lines 0.8. CI `ci.yml:18` uses
`lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` without
`build`; the pinned file equals the config clone `bc87049` and runs
`bun install --frozen-lockfile`, lint, typecheck and test (`check.yml:26`, `:28`, `:30`, `:38`).
The other CI jobs (`ci.yml:20` `bench-selftest`, `:35` `docker`) do not depend on the contract
version beyond install. Bench: `bun bench/run.ts` (api `bench/README.md:76-100`).

Behavior: R7, in Rollout step 3. Pin `@lorenzh/pulse-contract` to the full SHA of the contract
merge commit with the patch (today `c5ce6685ce8b563a243823bca451032291b81adb`,
`package.json:31`). No api source change.

Precondition, checked before any edit (the readers-first rule; `targets.json` already makes this
child wait for the console and notify children):
- console `main` and notify `main` each pin a contract commit that contains the patch commit:
  read the pin with
  `gh api "repos/lorenzh/pulse-<console|notify>/contents/package.json?ref=main" --jq .content | base64 -d | grep pulse-contract`,
  then `gh api repos/lorenzh/pulse-contract/compare/<patch sha>...<pin> --jq .status` is
  `identical` or `ahead`. If either is not, request a `needs-input` hold naming the repository:
  merging api first would let it store `Ops < ops@example.test >`, which an old console or notify
  refuses (Rollout order).
- api `main` does not yet pin a commit that contains the patch; if it does, request a hold because
  the change is already there.

Tests (in the existing `server.notify-channels.test.ts`, real server on port 0):
- `POST /admin/notify/channels` with an email channel whose `smtp.clientName` is `pulse_console`
  answers 422 with error `channel.smtp.clientName: must be a host name`, and storage, revision and
  audit stay unchanged (same pattern as the test "invalid writes give 422 ...", line 339).
- `POST /admin/notify/channels` with `from: "Ops <ops@example.test> trailing"` answers 422.
- `PUT /service/notify/report` with `fileChannels[0].refs[0] = "😀".repeat(101)` answers 422;
  with `"😀".repeat(100)` it answers 204.
- Mixed check M4: `POST /admin/notify/channels` with
  `{id:"mail", type:"email", smtp:{host:"smtp.test", port:587}, from:"Ops < ops@example.test >", to:["ops@example.test"]}`
  answers 201, and both `GET /admin/notify/channels` and `GET /service/notify/channels` return
  that channel with `from` equal to the literal `"Ops < ops@example.test >"` (stored unchanged,
  no trimming).
The three reject cases and M4 fail by assertion on the 2.4.0 pin (they get 201, 201, 204 and
422; the 422 is check M1, recorded in the PR) and pass on the new pin; the `"😀".repeat(100)`
accept case is a control and passes on both. Expected status codes and texts are the literals
here.

Completion evidence: the precondition output (both reader pins and their compare status) in the
PR; the reject cases and M4 fail with the old pin and pass with the new one, the control passes
with both; `bun run check` passes; `grep -n "pulse-contract" package.json bun.lock` shows the new
SHA in both. Performance (see Performance impact): test CPU A/B of `bun run test`, the startup
import A/B (expected about +1.4 ms CPU and +0.1 MiB), and the `bun bench/run.ts` A/B when Docker is
available, numbers in the PR.

## Risks

- Version label: the issue says 2.4.1, the release is 2.5.1 (Goal). If the owner wants a different
  label, the spec PR review is the place to say so; nothing else in the spec depends on the number.
- Patch number race with #823 (docs-only contract patch): whichever merges second takes the next
  patch; the version line conflicts in `package.json` and is resolved with the `merge` workflow.
- Consumers that started on 2.4.0 test data with the defective inputs: the api and console tests
  of their #570 work use `clientName: "pulse.example.com"` and plain or `Name <addr>` addresses
  (console `src/notification-form.test.ts:52`, `:54`), which stay valid. A failing existing test
  after the bump is a real disagreement with notify and is fixed in its test data, not by keeping
  the old pin.
- Race with #809/#820: handled by the precondition and the "blocked by" links (Rollout step 2).
- api waits for notify, so for #820: the api bump comes last. That delay is the price of the
  readers-first rule (Rollout order); the old api only keeps accepting inputs that notify's own
  rules refuse anyway.
- Mixed versions outside Factory's merge order (a `dev` stack with an old console checkout and a
  new api, a later deploy image bump, a rollback): Rollout order "Releases, deploy and rollback"
  gives the rule. Deploy is not changed here; a person carries the rule into the first deploy
  change that ships #570's notify channels.
- Rows stored before the patch in `dev` databases (`trailing`, `pulse_console`) make the new
  console show no channels until fixed: Rollout order "Rows stored before the patch".
  A merge conflict in `package.json`/`bun.lock` is resolved with the `merge` workflow, keeping the
  patch SHA (it contains 2.5.0).
- Other contract text limits still count code points while R1's report limits count UTF-16 units.
  The docs say which is which (R5). A follow-up issue can align them.
- Issue #822 ("contract: make the notify channel validators match notify's rules (2.4.1)", body
  "Refs lorenzh/pulse-meta#815", opened by the Factory app before this spec was approved) looks
  like an early child of this feature. A person checks it before fan-out so that the contract work
  is not built twice.

## Acceptance evidence

1. Contract: on the unchanged source (`src/notify-channels.ts` equal to 2.4.0's), every defect case
   of the contract section's items 1-4 fails by assertion and every control passes; after the
   change all pass. Expected values are the literals of this spec.
2. Contract: `bun run check` passes; `git diff --exit-code -- dist` after `bun run build` is empty;
   `package.json` version is the literal `2.5.1` (or the next free patch literal named in the PR);
   `src/index.ts` is unchanged against `origin/main`; `WIRE_VERSION` is the literal `1`.
3. Contract: `docs/index.md` contains `NotifyFailedEvent` and `ResendCommandState` with their
   literal values.
4. Parity: notify's `test/contract-parity.test.ts` shows notify `0464b90` rules and the contract
   patch give the same accept/reject result for every row of the R2/R3 table (two independent
   implementations plus a literal per row).
5. Consumers: console, status, notify and api pin the full patch merge SHA in `package.json` and
   `bun.lock`, and `bun run check` passes in each; console also passes `bun run check:browser` and
   CI `deploy-dev`, status passes `bun run check:a11y`.
6. Order: api merges after console and notify; its PR shows both reader pins contain the patch
   (`compare` status `identical` or `ahead`).
7. Mixed versions: checks M2 (console), M3 (notify) and M4 (api) fail by assertion on the 2.4.0
   pin and pass on the patch; M1 (old api answers 422 to `Ops < ops@example.test >`) is recorded
   in the api PR. Expected values are the literals of Rollout order.
8. Performance: each PR that adds tests reports its test CPU A/B (user + system of `bun run test`,
   median of five alternating runs per side); api and notify also report the startup import A/B.
   A difference above the expectations of Performance impact (more than 10 ms startup CPU, 2 MiB
   RSS, or 0.5 s test CPU) is a finding in the PR.
