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
are no findings yet.

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
7. Pin bumps in api, console, status and notify to the merged patch commit, with a test per
   consumer where the consumer runs a changed validator.

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

R7. **Consumers.** api, console, status and notify pin `@lorenzh/pulse-contract` to the full
40-character SHA of the pulse-contract `main` commit that contains R1-R6, in `package.json` and
`bun.lock`, following contract `docs/index.md` "Bump the pin in a consumer" (`:737-747`).

## Performance impact

Only the contract keys of api `bench/budgets.json` can move: `contract.test_cpu_s` (budget 9.0 s,
`bench/budgets.json:234-239`) and `contract.build_cpu_s` (budget 6.4 s, `:240-244`). Expected
change: below noise (some dozen new assertions; no new module). The validators replace a Zod
length check with one `.length` comparison and one anchored regex, both linear in a string already
capped at 200 or 300 characters, so no service key (startup CPU, load CPU, idle or peak RSS, test
CPU, wall-clock startup, p95 latencies, requests per second, image size) moves measurably after the
pin bumps: none expected, because the changed code runs only on admin channel writes, the notify
report PUT and notify's channel sync, which no bench scenario of api `bench/` drives. The pin bump
also brings the 2.5.0 subscription module into api and console; it is loaded only when imported
and neither imports it, so image size grows by its `dist` files only (about 5 KB of
JavaScript: `dist/subscriptions.js` 4291 bytes, `dist/validate-subscriptions.js` 844 bytes). The contract implementer reports
`bun test` wall time before and after; no A/B bench run is required.

## Security impact

Security impact: yes. The change edits validators at a trust boundary (contract) and bumps a
dependency pin in four services.

Checklist items that apply:
- **Input validation**: R1-R4 tighten accepted input; nothing is loosened except the
  space-padded address `Ops < a@b >`, which notify already accepts and which still yields a plain
  `local@domain` envelope after trimming. Validators never throw, read own data properties only
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

Consumer pins today: api `c5ce668` (`package.json:31`), console `c5ce668` (`package.json:32`),
status `b637302` (`package.json:34`, from #819), notify `c5ce668` (`package.json:30`, from #810),
probe `7ce23aa`. Open work on the same files: #809 (status child of #570, in `implement`) and #820
(notify child of #573, in `implement`; it bumps notify to `b637302`, 2.5.0).

1. **contract** merges R1-R6 to `main`. Nothing runs contract code by itself; every consumer keeps
   its old pin and keeps working: api and console keep 2.4.0's looser checks (they only still
   accept the defects until step 2); status uses no notify validator (its `src/` has no
   `validateNotify*` or `validateAdminNotify*` call); notify keeps its own stricter local rules;
   probe uses none of the changed validators.
2. **api** and **console** bump the pin (in parallel). Mixed states during the rollout:
   - api new + console old: the console form can accept an address or `clientName` that api
     now refuses; api answers 422 with the contract error and stores nothing. No data is lost.
   - api old + console new: the console refuses those inputs before sending; api accepts what
     the console sends. The failed view that api builds without a report is already
     `{state:"never", receivedAt:null, failed:[], failedTotal:0}` (api
     `src/notify-channel-routes.ts:211`), so a new console accepts it.
   - Notify reports cut to R1 limits in UTF-16 units (`cutText`, see Evidence), so a new api accepts
     every report notify sends.
3. **status** bumps after #809 is merged; **notify** bumps after #820 is merged. Both wait so that
   the bump does not race an in-flight pin or lockfile change in the same repository. A person links
   the status child as "blocked by" #809 and the notify child as "blocked by" #820 after fan-out
   (both children already wait for the contract child through `dependsOn`). Precondition checked by
   each child before editing (see its section): the named issue is closed, `main` pins a contract
   commit that contains `c5ce668`, and that pin does not yet contain the patch commit. Otherwise the
   child requests a hold (`needs-input` while the issue is open or the pin is older than
   `c5ce668`; a plain hold when the pin already contains the patch, because the behavior is
   already there).
   - Notify old + api new: notify's report always passes the new api (step 2). Notify new: its
     channel sync (`src/remote-channels.ts:55-62`, `src/channel-sync.ts:74`) refuses the R2/R3
     defect inputs one level earlier (as a contract rejection of the element instead of a local
     rejection); `test/remote-channels.smtp-name.test.ts:46-50` already allows both.
   - Notify's ledger re-checks stored remote rows with `validateNotifyChannelDefinition` at open
     (`src/ledger.ts:510-514`, `:549` refuses the whole file on a bad row). This stays safe: a row
     is stored only after notify's local rules accepted it (`src/channel-sync.ts:266-276`), and
     every input the patch newly refuses is refused by those local rules too (Evidence table), so no
     stored row can fail the new check.
4. Deploy (#811, #821) is not part of this spec; it picks up the new images when it runs.

Database channels written by an api on 2.4.0 with an address like `Ops <a@b> trailing` or a
`clientName` like `pulse_console` would fail the new record check. Nothing is deployed yet (#811
is open), so only development databases can hold such rows, and notify's own rules already refuse
those channels.

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

## Repository: api

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `src/server.notify-channels.test.ts` (change: new cases)

Behavior change: yes. api's channel writes (`src/notify-channel-routes.ts:135`) and the notify
report PUT (`:325`) run the tightened validators and now answer 422 for the R1-R3 rejects.

Tool facts (verified at `b6f1d53`): Bun 1.4.0 (`package.json:9` `engines.bun`, `:35`
`packageManager`); `bun run check` = lint, typecheck, test (`package.json:20`); lint adds
`pulse-workflows`; `bunfig.toml:1-3` coverage threshold lines 0.8. CI `ci.yml:18` uses
`lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` without
`build`; the pinned file equals the config clone `bc87049` and runs
`bun install --frozen-lockfile`, lint, typecheck and test (`check.yml:26`, `:28`, `:30`, `:38`).
The other CI jobs (`ci.yml:20` `bench-selftest`, `:35` `docker`) do not depend on the contract
version beyond install.

Behavior: R7. Pin `@lorenzh/pulse-contract` to the full SHA of the contract merge commit with the
patch (today `c5ce6685ce8b563a243823bca451032291b81adb`, `package.json:31`). No api source change.

Tests (in the existing `server.notify-channels.test.ts`, real server on port 0):
- `POST /admin/notify/channels` with an email channel whose `smtp.clientName` is `pulse_console`
  answers 422 with error `channel.smtp.clientName: must be a host name`, and storage, revision and
  audit stay unchanged (same pattern as the test "invalid writes give 422 ...", line 339).
- `POST /admin/notify/channels` with `from: "Ops <ops@example.test> trailing"` answers 422.
- `PUT /service/notify/report` with `fileChannels[0].refs[0] = "😀".repeat(101)` answers 422;
  with `"😀".repeat(100)` it answers 204.
The three reject cases fail by assertion on the 2.4.0 pin (they get 201, 201 and 204) and pass on
the new pin; the `"😀".repeat(100)` accept case is a control and passes on both. Expected status
codes are the literals here.

Completion evidence: the three reject cases fail with the old pin and pass with the new one, the
control passes with both; `bun run check` passes; `grep -n "pulse-contract" package.json bun.lock`
shows the new SHA in both.

## Repository: console

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `src/notification-form.test.ts` (change: new cases)

Behavior change: yes. `parseChannelForm` (`src/notification-form.ts:270`) and the admin view reads
(`src/runtime-read.ts:98`, `:113`) run the tightened validators.

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

Behavior: R7. Pin to the same full SHA as api (today `c5ce668...`, `package.json:32`). No source
change; the form shows the contract error as it does today (`errors: [{ name: "id", text }]`).

Tests (in `src/notification-form.test.ts`):
- `parseChannelForm` with the valid email input of the existing test but `smtp_client_name:
  "pulse_console"` gives `isOk: false` with text
  `channel.smtp.clientName: must be a host name`.
- the same with `from: "Ops <ops@example.test> trailing"` gives `isOk: false`; with
  `from: "Ops < ops@example.test >"` gives `isOk: true`.
Each of the three fails by assertion on the 2.4.0 pin and passes on the new pin. The existing
valid input (`clientName: "pulse.example.com"`, `from: "Pulse <pulse@example.com>"`,
`src/notification-form.test.ts:52`, `:54`) is the control and passes on both.

Completion evidence: the new cases fail with the old pin and pass with the new one;
`bun run check` passes; `bun run check:browser` passes; the CI jobs `check`, `browser` and
`deploy-dev` pass on the PR; the pin shows the new SHA in `package.json` and `bun.lock`; per
console `AGENTS.md:87`, `PULSE_API_URL=http://localhost:3000 bun start` (or the fixture console
`bun e2e/run.ts --serve`, `AGENTS.md:25`) with one email channel save using
`clientName` `pulse_console`, and the shown error, reported in the PR.

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

Behavior: R7, with the order of Rollout step 3. Precondition, checked before any edit:
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
`git diff --name-only` lists only those two files.

## Repository: notify

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `test/contract-parity.test.ts` (new)

Behavior change: yes. A runtime dependency pin changes, and notify's channel sync and ledger
(`src/remote-channels.ts:55-62`, `src/channel-sync.ts:74`, `src/ledger.ts:513`) run the tightened
contract validators. Notify's own rules (`src/channel-schema.ts`, `src/channels/mailer.ts`) do not
change.

Tool facts (verified at `0464b90`): Bun 1.4.0 (`package.json:9` `engines.bun`, `:35`
`packageManager`); `bun run check` = lint, typecheck, test (`package.json:17`); tests live in
`test/` (for example `test/remote-channels.smtp-name.test.ts`); `bunfig.toml:1-3` coverage
threshold lines 0.8. CI `ci.yml:18` uses the pinned `check.yml@04108fa...`, equal to the config
clone; the other job is `docker` (`ci.yml:20`).

Behavior: R7, with the order of Rollout step 3. Precondition, checked before any edit:
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

Existing tests that must keep passing on the new pin: `test/remote-channels.smtp-name.test.ts`
(the `mail/invalid` client name may now be refused at element level, which the test allows at
`:46-50`) and the ledger tests.

Completion evidence: the parity test fails on the old pin (bold rows only) and passes on the new
pin; `bun run check` passes; `package.json` and `bun.lock` show the new SHA; notify's `src/` is
unchanged (`git diff --stat -- src` empty).

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
- Race with #809/#820: handled by the precondition and the "blocked by" links (Rollout step 3).
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
5. Consumers: api, console, status and notify pin the full patch merge SHA in `package.json` and
   `bun.lock`, and `bun run check` passes in each; console also passes `bun run check:browser` and
   CI `deploy-dev`, status passes `bun run check:a11y`.
