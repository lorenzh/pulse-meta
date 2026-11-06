# Spec #815: contract 2.4.1, notify channel validators match notify's rules

## Goal

Contract 2.4.0 (pulse-contract PR #52, merge `c5ce6685ce8b563a243823bca451032291b81adb`, feature
#570, child #806) added the notify channel, report and failed-view validators. Three of them accept
input that notify's own rules refuse, one admin view accepts a contradiction, and the docs miss two
exported types. Contract 2.4.1 fixes these five points as a patch release. The services that build
on 2.4.0 (api, console, status, notify; owner decision in the last owner comment on #570: "Child
builds for api, status, notify and console use 2.4.0 now and bump the pin when 2.4.1 is released;
notify keeps its own existing rules") then bump their contract pin.

Inputs read for this spec: issue #815 and its comment, `.factory/work/815/issue-review.md`, the #570
spec (`.factory/work/570/plan.md`, R1 at lines 716-860), the clones of contract (`c5ce668`), notify
(`c79f0b7`), api (`b6f1d53`), console (`c0699b7`), status (`8b6d431`), config (`bc87049`). Shared
findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/815` answered HTTP 404,
so there are no findings yet.

## Evidence of the defects (run in this plan state)

Both sides ran under Node 24.19.0 with zod 4.6.7 (the exact version of contract `package.json` and
notify `package.json:33`), from copies of the clone sources in a scratch directory.

Zod 4.6.7 string `.max()` counts code points, not UTF-16 units:
`package/v4/core/checks.js:271-273` of the published `zod@4.6.7` tarball
(`const length = typeof input === "string" && units > def.maximum ? util.codePointLength(input) : units;`).
So R1's sentence "every length is JavaScript `string.length` (UTF-16 code units), which is what the
contract's zod `.max()` counts" (`.factory/work/570/plan.md:783-784`) is wrong about Zod.

Contract 2.4.0 public validators against notify `c79f0b7` (`channelSchema("email")` of
`src/channel-schema.ts`), base email channel
`{id:"mail", type:"email", smtp:{host:"smtp.test", port:587}, from:"pulse@x.test", to:["ops@x.test"]}`,
one field varied:

| Input | notify c79f0b7 | contract 2.4.0 |
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

Contract 2.4.0, other points:

| Input | R1 / issue | contract 2.4.0 |
| --- | --- | --- |
| report `fileChannels[0].refs[0]` = `"😀".repeat(100)` (200 units) | accept | accept |
| report `fileChannels[0].refs[0]` = `"😀".repeat(101)` (202 units) | reject | **accept** |
| report `fileChannels[0].refs[0]` = `"a".repeat(199) + "😀"` (201 units) | reject | **accept** |
| failed view `{state:"never", receivedAt:null, failed:[entry], failedTotal:1}` | reject | **accept** |
| failed view `{state:"never", receivedAt:null, failed:[], failedTotal:3}` | reject | **accept** |

Notify's reference rules at `c79f0b7` (copied here because the contract build context holds only
meta and config, `.factory/config.yaml:77`):

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
// /^[^\s<>@]+@[^\s<>@]+$/.test(envelopeAddress(v)); src/channel-schema.ts:106-110: clientName
// refines isEhloName.
```

## Scope

1. Notify report text lengths count UTF-16 code units (`string.length`) in the six report text
   positions of `src/notify-channels.ts` that use `viewText` (`:345-349`): file view `id` (1..200),
   each file view `refs` entry (1..200), rejected `channelId` (1..200, or `null`), rejected `reason`
   (1..300), failed `channelId` (1..200), failed `key` (1..300). They apply wherever these schemas
   are reused: `validateNotifyServiceReport`, `validateAdminNotifyChannelsView` (through
   `service.report`), `validateAdminNotifyFailedView` (through `failed`).
2. Email addresses (`from` and every `to` entry, shared schema `address`,
   `src/notify-channels.ts:99-107`) use notify's anchored extraction and trimming.
3. `smtp.clientName` (`src/notify-channels.ts:161-163`) uses notify's `isEhloName` predicate in
   addition to the existing 200 code-point `text` cap.
4. `validateAdminNotifyFailedView`: state `never` requires `failed: []` and `failedTotal: 0`.
5. `docs/index.md` lists `NotifyFailedEvent` and `ResendCommandState`, and states the corrected
   rules.
6. Version 2.4.1, `WIRE_VERSION` 1, `dist/` rebuilt.
7. Pin bumps in api, console, status and notify to the merged 2.4.1 commit, with a test per
   consumer where the consumer runs a changed validator.

## Non-goals

- No other string limit changes its counting. The routing lists (`text`, 200 code points,
  `src/notify-channels.ts:85-87`), `statusUrl`, status settings, status reports and the resend
  shapes (`src/resend.ts:52-55`) keep Zod's code-point counting. The docs say so (see contract
  section); making them count UTF-16 units is a separate issue if wanted.
- No change to channel ids, secret references, byte budgets, list or count limits, error message
  texts of existing rules, the service-channel envelope (`ownId` still reads only `id`), or the
  `NotifyServiceState` rules.
- The `clientName` cap stays the contract's 200 (`text`); notify's own ceiling is 255. A name of
  201..255 characters passes notify and fails the contract. That direction is safe (the contract is
  stricter) and the issue's constraint forbids widening an existing contract bound.
- No new export, no exported helper for tests, no new dependency, no import of notify code into
  contract.
- Notify's own schemas and messages do not change (owner decision on #570).
- No change to probe (pins `7ce23aa...`, uses no notify validator), deploy or kit.
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
validator never trims or rewrites the returned object.

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

R5. **Docs.** `docs/index.md`, section "Status and notify settings":
- names `NotifyFailedEvent` (one of `NOTIFY_FAILED_EVENTS`, the eight literals) and
  `ResendCommandState` (one of `RESEND_COMMAND_STATES`, the nine literals `queued`, `claimed`,
  `admitted`, `delivered`, `failed`, `dropped`, `not-failed`, `no-payload`,
  `channel-unavailable`);
- replaces the claim "every length counts UTF-16 code units (`string.length`)" (`:465`) with a true
  statement: the six notify report text lengths count UTF-16 code units; the other text limits of
  the section count Unicode code points;
- says that `AdminNotifyFailedView` with `state: "never"` has `receivedAt: null`, `failed: []` and
  `failedTotal: 0`;
- says that `from`/`to` take the address inside a final `<…>` (only whitespace may follow it) or
  the whole text, trimmed, and that `smtp.clientName` is a host name (dot-separated labels of 1..63
  ASCII letters, digits or `-`, not starting or ending with `-`) or an address literal in `[…]`,
  at most 200 characters;
- a short "2.4.1" note under the section intro: a patch that tightens these validators; wire
  version 1.

R6. **Release.** `package.json` `version` is `2.4.1`. `WIRE_VERSION` stays `1`. The export list of
`src/index.ts` and the dependency set of `package.json` are unchanged. `dist/` is rebuilt and
committed.

R7. **Consumers.** api, console, status and notify pin `@lorenzh/pulse-contract` to the full
40-character SHA of the pulse-contract `main` commit that contains R1-R6, in `package.json` and
`bun.lock`, following `docs/index.md` "Bump the pin in a consumer" of contract (`:682-692`).

## Performance impact

Only the contract keys of api `bench/budgets.json` can move: `contract.test_cpu_s` and
`contract.build_cpu_s`. Expected change: below noise (some dozen new assertions; no new module). The
validators replace a Zod length check with one `.length` comparison and one anchored regex, both
linear in a string already capped at 200 or 300 characters, so no service key (startup CPU, load
CPU, idle or peak RSS, test CPU, wall-clock startup, p95 latencies, requests per second, image
size) moves measurably after the pin bumps: none expected, because the changed code runs only on
admin channel writes and the notify report PUT, which no bench scenario of api `bench/` drives. The
contract implementer reports `bun test` wall time before and after; no A/B bench run is required.

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

1. **contract** merges R1-R6 to `main`. Nothing runs contract code at run time by itself; every
   consumer keeps its old pin and keeps working:
   - api and console at `c5ce668` (2.4.0) keep 2.4.0's looser checks; nothing breaks, they only
     still accept the five defects until step 2.
   - status and notify at `9ab7e24` (before 2.4.0) do not use any notify validator on `main`.
   - probe at `7ce23aa` uses none of the changed validators.
2. **api** and **console** bump the pin (in parallel). Mixed states during the rollout:
   - api 2.4.1 + console 2.4.0: the console form can accept an address or `clientName` that api
     now refuses; api answers 422 with the contract error and stores nothing. No data is lost.
   - api 2.4.0 + console 2.4.1: the console refuses those inputs before sending; api accepts what
     the console sends. The failed view that api builds without a report is already
     `{state:"never", receivedAt:null, failed:[], failedTotal:0}` (api
     `src/notify-channel-routes.ts:211`), so a 2.4.1 console accepts it.
   - Notify reports cut to R1 limits in UTF-16 units (R1 cut rule), so api 2.4.1 accepts every
     report notify is specified to send.
3. **status** and **notify** bump the pin after their #570 children (#809 status, #810 notify)
   are merged, so the bump does not race their in-flight pin to 2.4.0. A person links the status
   child as "blocked by" #809 and the notify child as "blocked by" #810 after fan-out (both
   children already wait for the contract child through `dependsOn`). If a child starts while its
   target's `main` still pins a contract older than `c5ce668`, it requests a `needs-input` hold
   instead of bumping. If `main` already pins the 2.4.1 commit or a later one, it requests a hold
   because the behavior is already there.
4. Deploy (#811) is not part of this spec; it picks up the new images when it runs.

Database channels written by an api on 2.4.0 with an address like `Ops <a@b> trailing` or a
`clientName` like `pulse_console` would fail the 2.4.1 record check. Nothing is deployed yet (#811
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

No statistic is defined by this spec.

## Contract fields

No new names: no new export, field, key, constant or route. The two names the docs gain already
exist:
- `grep -n "NotifyFailedEvent\|ResendCommandState" .repos/contract/src/index.ts` gives
  `84:  NotifyFailedEvent,` and `106:  ResendCommandState,`.
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

Tool facts (verified):
- Bun 1.4.0: `package.json:7` (`packageManager`) and `:9` (`engines.bun`).
- `bun run check` = lint, build, typecheck, test: `package.json:28`; lint is
  `biome check . && pulse-eslint .` (`:25`), build and typecheck use `typescript7` (`:22-23`).
- `bunfig.toml` `[test]`: coverage on, line threshold 0.8 (`bunfig.toml:1-3`).
- CI: `.github/workflows/ci.yml:17-19` uses
  `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0` with
  `build: true`. That pinned file (read with `gh api .../contents/.github/workflows/check.yml?ref=51e95b0...`)
  is identical to the config clone `bc87049`; it runs `bun install --frozen-lockfile` (`:26`),
  `bun run lint` (`:28`), `bun run typecheck` (`:30`), `bun run build` (`:33`),
  `git diff --exit-code -- dist` (`:36`) and `bun run test` (`:38`).
- `test/smoke.test.ts:15` fails when `dist/` differs from a fresh build.

Behavior: R1 to R6 exactly. Tests go first (AGENTS.md "Tests (TDD)"): write the tests below, run
them on the unchanged source, and record in the PR which assertions fail on 2.4.0; then implement.

Tests in `test/notify-channels.test.ts`, through the public validators only, with otherwise valid
fixtures and one field varied:
1. Report lengths: for each of the six positions, the 200/300-unit accept and the 202/302-unit
   reject with emoji, the mixed `"a".repeat(198) + "😀"` accept and `"a".repeat(199) + "😀"`
   reject in a 200 field, and `""` reject; through `validateNotifyServiceReport`, plus one case
   each through `validateAdminNotifyChannelsView` (`service.report.fileChannels[0].refs[0]`) and
   `validateAdminNotifyFailedView` (`failed[0].key`). Expected errors are the literals of the
   Counterexamples section.
2. Addresses: the R2 counterexample list for `from` and for `to[0]`, through
   `validateNotifyChannelDefinition`; the reject cases also through `validateNotifyChannelRecord`
   and `validateAdminNotifyChannelsView` (`channels[0]` a database view). An accepted input returns
   the same object (`Object.is`) with the original `from` text.
3. Client name: the R3 lists through `validateNotifyChannelDefinition`, `pulse_console` also through
   `validateNotifyChannelRecord` and `validateAdminNotifyChannelsView`; `clientName` absent stays
   valid. The NUL case uses a string that contains U+0000.
4. Never view: the R4 rejects with the exact errors of R4 and the accepts of the Counterexamples.
5. Release: `package.json` `version` equals the literal `"2.4.1"` (read the file in the test or
   check it in the PR evidence); `test/version.test.ts` keeps asserting `WIRE_VERSION === 1`.
6. Hostile inputs (Security impact): an address of `"<".repeat(50_000) + "a".repeat(50_000)` and a
   `clientName` of `".[".repeat(50_000)` are rejected without throwing.

Expected values come from the literals of this spec; the reference booleans for R2 and R3 come
from executing notify `c79f0b7` (Evidence section), an independent implementation, not from the
new contract code.

Completion evidence:
- The list of tests from 1-4 that fail on `c5ce668` (by assertion, not by a crash) and pass after
  the change.
- `bun run check` passes.
- `bun run build` then `git diff --exit-code -- dist` is empty.
- `git diff c5ce6685ce8b563a243823bca451032291b81adb -- src/index.ts` is empty and
  `git diff c5ce6685ce8b563a243823bca451032291b81adb -- package.json` shows only the `version`
  line `2.4.0` -> `2.4.1`.
- `grep -n "NotifyFailedEvent\|ResendCommandState" docs/index.md` shows both names.
- The R2/R3 table of the Evidence section, run against the new public
  `validateNotifyChannelDefinition`, gives the "notify c79f0b7" column for every row (record the
  output in the PR).

## Repository: api

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `src/server.notify-channels.test.ts` (change: new cases)

Behavior change: yes. api's channel writes (`src/notify-channel-routes.ts:135`) and the notify
report PUT (`:325`) run the tightened validators and now answer 422 for the R1-R3 rejects.

Tool facts (verified): Bun 1.4.0 (`package.json:9` `engines.bun`, `:35` `packageManager`);
`bun run check` = lint, typecheck, test (`package.json:20`); lint adds `pulse-workflows`
(`package.json:16`); `bunfig.toml:1-3` coverage threshold lines 0.8. CI `ci.yml:18` uses
`lorenzh/pulse-config/.github/workflows/check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7` without
`build`; the pinned file equals the config clone `bc87049` and runs
`bun install --frozen-lockfile`, lint, typecheck and test (`check.yml:26`, `:28`, `:30`, `:38`).

Behavior: R7. Pin `@lorenzh/pulse-contract` to the full SHA of the contract merge commit with
2.4.1 (today `c5ce6685ce8b563a243823bca451032291b81adb`, `package.json:31`). No api source change.

Tests (in the existing `server.notify-channels.test.ts`, real server on port 0):
- `POST /admin/notify/channels` with an email channel whose `smtp.clientName` is `pulse_console`
  answers 422 with error `channel.smtp.clientName: must be a host name`, and storage, revision and
  audit stay unchanged (same pattern as the test "invalid writes give 422 ...", line 339).
- `POST /admin/notify/channels` with `from: "Ops <ops@example.test> trailing"` answers 422.
- `PUT /service/notify/report` with `fileChannels[0].refs[0] = "😀".repeat(101)` answers 422;
  with `"😀".repeat(100)` it answers 204.
The three reject cases fail on the 2.4.0 pin (they get 201, 201 and 204) and pass on 2.4.1; the
`"😀".repeat(100)` accept case passes on both. Expected status codes are the literals here.

Completion evidence: the three new cases fail with the old pin and pass with the new one;
`bun run check` passes; `grep -n "pulse-contract" package.json bun.lock` shows the new SHA in both.

## Repository: console

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `src/notification-form.test.ts` (change: new cases)

Behavior change: yes. `parseChannelForm` (`src/notification-form.ts:270`) and the admin view reads
(`src/runtime-read.ts:98`, `:113`) run the tightened validators.

Tool facts (verified): Bun 1.4.0 (`package.json:9`, `:35`); `bun run check` = lint, typecheck,
test (`package.json:18`); typecheck also checks `e2e` (`package.json:13`); `bunfig.toml:1-3`
coverage threshold lines 0.8. CI `ci.yml:18` uses the pinned `check.yml@04108fa...`, equal to the
config clone (install frozen, lint, typecheck, test).

Behavior: R7. Pin to the same full SHA as api (today `c5ce668...`, `package.json:32`). No source
change; the form shows the contract error as it does today (`errors: [{ name: "id", text }]`).

Tests (in `src/notification-form.test.ts`):
- `parseChannelForm` with the valid email input of the existing test but `smtp_client_name:
  "pulse_console"` gives `isOk: false` with text
  `channel.smtp.clientName: must be a host name`.
- the same with `from: "Ops <ops@example.test> trailing"` gives `isOk: false`; with
  `from: "Ops < ops@example.test >"` gives `isOk: true`.
Each fails on the 2.4.0 pin and passes on 2.4.1.

Completion evidence: the new cases fail with the old pin and pass with the new one;
`bun run check` passes; the pin shows the new SHA in `package.json` and `bun.lock`.

## Repository: status

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)

Behavior change: yes. A runtime dependency pin changes; status uses no changed validator, so no
status behavior is expected to change, and no new test is required.

Tool facts (verified): Bun 1.4.0 (`package.json:9`, `:38`); `bun run check` = lint, typecheck,
test (`package.json:19`); `bunfig.toml:1-3` coverage threshold lines 0.8. CI `ci.yml:18` uses the
pinned `check.yml@04108fa...`, equal to the config clone.

Behavior: R7, with the order of Rollout step 3. Precondition: status `main` pins contract
`c5ce6685ce8b563a243823bca451032291b81adb` (2.4.0, from #809). Today it pins
`9ab7e2492a2cec91789fba7c742bdba900a800a9` (`package.json:34`). If `main` still pins a commit older
than `c5ce668` when the child starts, request a `needs-input` hold naming #809; if it already pins
the 2.4.1 commit or later, request a hold because the change is already there.

Completion evidence: `bun run check` passes on the new pin; `package.json` and `bun.lock` show the
new SHA; `git diff` touches only those two files.

## Repository: notify

Files:
- `package.json` (change: contract pin)
- `bun.lock` (change: contract pin)
- `test/contract-parity.test.ts` (new)

Behavior change: yes. A runtime dependency pin changes, and notify's #810 code (channel records,
report) runs contract validators. Notify's own rules (`src/channel-schema.ts`,
`src/channels/mailer.ts`) do not change.

Tool facts (verified): Bun 1.4.0 (`package.json:9`, `:35`); `bun run check` = lint, typecheck,
test (`package.json:17`); tests live in `test/` (for example `test/channels.test.ts`);
`bunfig.toml:1-3` coverage threshold lines 0.8. CI `ci.yml:18` uses the pinned
`check.yml@04108fa...`, equal to the config clone.

Behavior: R7, with the order of Rollout step 3. Precondition: notify `main` pins contract
`c5ce6685ce8b563a243823bca451032291b81adb` (2.4.0, from #810). Today it pins
`9ab7e2492a2cec91789fba7c742bdba900a800a9` (`package.json:30`). If `main` still pins a commit older
than `c5ce668` when the child starts, request a `needs-input` hold naming #810; if it already pins
the 2.4.1 commit or later, request a hold because the change is already there.

Test `test/contract-parity.test.ts`: for every row of the R2/R3 table of the Evidence section,
build the base email channel with the one field varied and assert that
`channelSchema("email")?.safeParse(input).success` (notify) equals
`validateNotifyChannelDefinition(input).ok` (contract) and equals the literal expected boolean of
the "notify c79f0b7" column. The `"x".repeat(64)` and other rows are written out as literals;
the 201..255-character `clientName` case is left out (Non-goals: the contract keeps its 200 cap).
This compares two independent implementations and a literal, so it fails if either side drifts.
Its rows with a bold contract 2.4.0 value fail on the old pin.

Completion evidence: the parity test fails on `c5ce668` (rows marked bold above) and passes on the
2.4.1 pin; `bun run check` passes; `package.json` and `bun.lock` show the new SHA; notify's
`src/` is unchanged (`git diff --stat -- src` empty).

## Risks

- Consumers that started on 2.4.0 test data with the defective inputs: the api and console tests
  of their #570 work use `clientName: "pulse.example.com"` and plain or `Name <addr>` addresses
  (console `src/notification-form.test.ts:52`, `:54`), which stay valid. A failing existing test
  after the bump is a real disagreement with notify and is fixed in its test data, not by keeping
  the old pin.
- Race with #809/#810: handled by the precondition and the "blocked by" links (Rollout step 3).
  A merge conflict in `package.json`/`bun.lock` is resolved with the `merge` workflow, keeping the
  2.4.1 SHA.
- Other contract text limits still count code points while R1's report limits count UTF-16 units.
  The docs say which is which (R5). A follow-up issue can align them.

## Acceptance evidence

1. Contract: each runtime test of the contract section's items 1-4 fails by assertion on
   `c5ce668` and passes after the change; expected values are the literals of this spec.
2. Contract: `bun run check` passes; `git diff --exit-code -- dist` after `bun run build` is empty;
   `package.json` version is the literal `2.4.1`; `src/index.ts` is unchanged against `c5ce668`;
   `WIRE_VERSION` is the literal `1`.
3. Contract: `docs/index.md` contains `NotifyFailedEvent` and `ResendCommandState` with their
   literal values.
4. Parity: notify's `test/contract-parity.test.ts` shows notify `c79f0b7` rules and contract 2.4.1
   give the same accept/reject result for every row of the R2/R3 table (two independent
   implementations plus a literal per row).
5. Consumers: api, console, status and notify pin the full 2.4.1 merge SHA in `package.json` and
   `bun.lock`, and `bun run check` passes in each.
