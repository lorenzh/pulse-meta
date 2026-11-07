# Issue review: #815

Reviewed 2026-11-07. Outcome: transition to `plan`. No question blocks the spec.

## Decisions carried forward

- The manager's added requirements supersede the original release number. Ship the next patch after the current contract `main` version: **2.5.1 on the inspected main, or a later patch if main advances before release; never downgrade**. Use this same rule in the plan and contract task acceptance. Keep `WIRE_VERSION = 1`.
- The EHLO regression and notify differential acceptance must contain the literal **`☃` (U+2603)** and require rejection. A different Unicode example alone does not satisfy this requirement.
- Preserve the earlier plan-review corrections: distinguish defect cases from unchanged controls; cite browser/Compose/accessibility tooling; account for eagerly loaded subscription modules and test CPU; and define a readers-first rollout for the newly accepted padded address.
- #570 / contract PR #52 supplied the channel/report/resend contract in 2.4.0. #573 / contract PR #53 supplied subscriptions in 2.5.0. Reuse both; do not rebuild either feature or remove subscriptions to recover a 2.4.x version.
- The final earlier plan-review found no blocking defects. Its decisions remain useful even though its artifacts are absent from this fresh checkout. GitHub confirms [PR #822](https://github.com/lorenzh/pulse-meta/pull/822) was the previous spec PR for this issue, closed without merge. It is not a duplicate contract child.

## Inspected evidence

Paths below are relative to the named read-only clone under `.repos/`.

| Repository | Inspected HEAD | Relevant state |
| --- | --- | --- |
| contract | `b637302363b3f147a99280e5961396e6c9f22e7a` | `package.json:3`: 2.5.0; GitHub main lookup matches. `src/version.ts:5`: wire version 1. |
| api | `b6f1d53c7c6e819741ef853fbada637895c29e71` | `package.json:31` pins contract `c5ce6685ce8b563a243823bca451032291b81adb` (2.4.0). |
| console | `c0699b7538cb688890cf688f7e9a2b79267189c4` | `package.json:32` pins the same 2.4.0 SHA. |
| notify | `0464b90c0ebfe52fe8ca918e7362677ed366b034` | `package.json:30` pins the same 2.4.0 SHA; contains the #810 runtime-channel implementation. |
| status | `d602c9419a58364625768e11ff86265327dede6e` | `package.json:34` pins contract `b637302363b3f147a99280e5961396e6c9f22e7a` (2.5.0). |

Read meta `AGENTS.md`, `README.md`, `.factory/prompts/issue-review.md`, and the five target instruction files. Target code stays read-only; this state writes only this review.

Contract `src/notify-channels.ts` identifies the defects and the narrow edit boundaries:

- `viewText` at lines 345-349 uses string `.max()`. It is shared by six report text positions: file-channel `id` and `refs[]` (200), rejected `channelId` (nullable, 200) and `reason` (300), failed-delivery `channelId` (200) and `key` (300). The report and nested admin views inherit these schemas.
- `envelopeAddress` at lines 103-106 selects the last angle brackets, does not trim the inner address, and permits text after `>`. It differs from notify's helper. The address schema is shared by `from` and every `to[]` entry (lines 99, 167-168).
- `smtp.clientName` at lines 161-163 only rejects empty/whitespace names. It allows underscores, Unicode and NUL. The existing text bound is 200 and must remain.
- `adminNotifyFailedViewSchema` at lines 481-495 checks the received timestamp and total/list relationship, but has no empty-list/zero-total rule for `never`.
- `docs/index.md:515-580` documents the feature but omits `NotifyFailedEvent` and `ResendCommandState`. Its blanket statement at line 520 that every length counts UTF-16 units overstates the current implementation.
- `src/index.ts:84,106` already exports both missing documented types. No new export is required. `dist/` is tracked; the contract instructions require rebuilding and committing it. `package.json:28` makes `bun run check` run lint, build, typecheck and tests.

Notify is the independent behavioral reference:

- `src/channels/mailer.ts:6-22` implements hostname labels/address literals and a 255-unit outer bound for `isEhloName`. Mirror its acceptance predicate locally in contract without importing a service or strengthening its literal syntax. Contract's existing 200 cap remains an additional wire limit.
- `src/channels/mailer.ts:35-37` uses `/<([^<>]*)>\s*$/` and trims the extracted address or whole value. `src/channel-schema.ts:32-39,125-139` applies these helpers to email sender/recipient and SMTP client name.
- `src/remote-channels.ts:21-26` already cuts text using `.length`, with surrogate-pair protection. `src/service-report.ts:11-14,153-163` supplies the 200/300-unit display bounds. This fix validates display text; it must not add truncation or normalization to contract.
- `src/remote-channels.ts:54-66` validates each database record with contract before resolution. `src/ledger.ts:509-513,541-550` validates stored remote definitions when reopening the ledger and refuses an unsupported row. Both paths matter for rollout and rollback.

Consumer behavior confirms that dependency bumps are part of the feature:

- api `src/notify-channel-routes.ts:133-137` turns a failed contract definition check into HTTP 422; lines 325-326 similarly validate reports. Creation answers 201 at line 369. Lines 211-212 already emit the correct empty `never` failed view.
- console `src/notification-form.ts:270` checks writes with contract. `src/runtime-read.ts:89-98` validates the complete admin channels view, so one newly accepted row can invalidate an old reader's entire list.
- status `src/server.ts:231` serves the contract notify-channel module to the browser; its instructions require browser-safe contract dependencies. A pin-only update must keep those assets and imports usable.

## Open points resolved by scope assumptions

1. **Report limits only.** Replace the `viewText` length check with a `.length` check for all six positions, preserving minimum 1, nullability, error paths and existing bounded-list/byte rules. Do not change shared channel `text`, `statusUrl`, status settings, resend keys or unrelated validators. Adjust the blanket docs sentence so it describes report text accurately without promising a broader runtime change.
2. **Email validation, not rewriting.** Use notify's exact anchored extraction and trimming for validation of `from` and `to[]`; preserve the original object and original address spelling returned by validators. Keep the existing single-line and size checks. Do not introduce a full RFC email parser or broaden other channel fields.
3. **EHLO parity has a bounded domain.** Copy the private hostname/address-literal rule, retaining the existing 200 cap. Notify allows some names above that cap, so do not demand universal parity beyond this feature's listed inputs. Keep its current permissive address-literal grammar rather than silently replacing it with an IP parser. No exported helper and no dependency addition.
4. **Failed-view invariant.** `never` requires `receivedAt: null`, `failed: []`, `failedTotal: 0`. Preserve the existing timestamp and total/list rules for every state. A nonempty `never` list with total 0 already fails; use total 1 to isolate the newly fixed defect.
5. **Release race.** [#823](https://github.com/lorenzh/pulse-meta/issues/823), the separate subscription export documentation follow-up, is open. Recheck main before building/releasing and choose its next patch; preserve intervening changes. Do not fold unrelated runtime subscription work into this fix. Coordinate any overlapping docs inventory fixes rather than weakening checks.
6. **Consumers.** Retain contract, console, status, notify and api as targets. Consumers update `package.json` and `bun.lock` to a full SHA on contract main that contains this fix, preserving other merged features. Status is a pin-only change unless a demonstrated integration failure requires otherwise. No kit/config/probe/website change is derived from this request. Keep deploy image activation as an explicit release condition, not an unrequested deploy implementation target.
7. **In-flight prerequisites.** Live GitHub reads show [#809](https://github.com/lorenzh/pulse-meta/issues/809) (status runtime settings) and [#820](https://github.com/lorenzh/pulse-meta/issues/820) (notify subscriptions) are still open. Status must wait for #809; notify must wait for #820. Their children recheck closure and that main's pin contains the prerequisite contract commit (GitHub compare, not version text alone); if unmet, use a child `needs-input` hold before editing. Carry native `blocked by` links into fan-out coordination. These implementation prerequisites do not block writing this spec.

## Compatibility and activation

The padded address is an expansion of accepted data. A new console can submit it while an old api still returns 422; once stored by a new api, an old console rejects the whole admin view and old notify rejects the record. Notify's old contract also rejects the padded definition in a reopened ledger. Therefore:

- Build contract first, then console/status/notify pins; activate console and notify readers before activating the api writer. Use target dependencies: console/status/notify depend on contract; api depends on contract, console and notify. Status's external #809 prerequisite remains independent.
- Before the api child edits, verify console main and notify main both pin a contract commit containing the fix. A missing reader update is a child hold, not permission to change another repository.
- Merge order alone is insufficient for running stacks. In development deployments, update the running console and notify readers before the api writer, or stop the stack and update them together. Carry the patch requirement into the first deploy change shipping runtime notify channels; ship api/console/notify images together containing the fix. Current deploy `common/services.yaml:8,35,44` pins 0.1.0 images; earlier comments established those releases predate runtime notify channels. Do not treat image tags as evidence that newer readers are running.
- Check existing development api channel rows and notify ledger definitions against the stricter predicate before activation. Correct newly invalid trailing-address/EHLO values through supported configuration/admin flows and synchronize notify while the old stack can still read them. Do not silently drop ledger data or edit databases as part of this validator patch.
- Do not roll console/notify readers back while api or ledger data contains newly accepted padded addresses. First stop such writes and replace these addresses with old-compatible spellings through supported flows, synchronize and verify stored rows, then roll writer/readers back in a compatible order. If that cannot be demonstrated, retain the patched readers.

## Derived acceptance

Use literal expectations in each regression; equality between two validators is insufficient because both could be wrong. Build otherwise valid, small fixtures so a byte cap or another field cannot mask the intended failure.

| Area | Required checks after the fix |
| --- | --- |
| Report lengths | For each of the six positions listed above, accept nonempty text exactly at the 200/300 UTF-16-unit limit and reject text over it; retain empty-string rejection and nullable rejected `channelId`. Specifically accept `"😀".repeat(100)` and reject `"😀".repeat(101)` in a 200-unit field, including file-view `refs[]`. Use 150/151 repeats for 300-unit fields. Exercise `validateNotifyServiceReport` and relevant containing admin validators. |
| Email | In both `from` and `to[]`, accept `Ops <ops@example.test>` and `Ops < ops@example.test >`; reject `Ops <ops@example.test> trailing`. Preserve plain-address/outer-trimming controls, CR/LF rejection and existing size limits. Successful validation returns the unchanged input. |
| EHLO | Accept `pulse.example.test` and `[192.0.2.1]`; reject `pulse_console`, literal `☃`, another non-ASCII hostname such as `münchen.test`, and a name containing `\u0000`. Retain omitted-name behavior and the 200 cap. Exercise definition and record/view validation where inherited. |
| Failed view | Accept `never/null/[]/0`; reject `never/null/[validEntry]/1` and `never/null/[]/1`. Retain controls for non-null `never` timestamp, `fresh`/`stale` timestamp requirements, negative totals and totals smaller than the list; allow valid fresh/stale views. |
| Docs | `docs/index.md` explicitly lists `NotifyFailedEvent` and `ResendCommandState`, explains the changed report/email/EHLO/never rules, and does not claim that unrelated string limits were changed. Both exports remain the same existing types. |
| Release | Package version is the next patch after current main (2.5.1 or later patch), no downgrade; `WIRE_VERSION` remains 1; no new export/dependency; rebuild tracked `dist/`; `bun run check` passes. Plan and contract task acceptance use the same release rule as this review. |

Baseline proof: one or more isolated assertion failures for each runtime defect on 2.4.0, then all pass after the fix. Also reproduce defects on the current pre-fix main. Defect cases are over-limit astral report text, padded-address acceptance, trailing-address rejection, invalid EHLO rejection (including literal `☃`), and the two inconsistent `never` cases. Unchanged positive and negative controls must pass on both versions. Do not require every assertion in a combined test to fail on the baseline or count module/install errors as regression evidence. Docs/version checks are final-state checks, not runtime red tests.

Mixed-version integration evidence must include:

1. **M1 api baseline:** authorized POST with the padded address returns 422 using the old pin. Record this as a baseline check, not a post-fix requirement.
2. **M2 console reader:** read a full admin list containing the padded address successfully; a corresponding list containing `trailing` is invalid. Add sender/recipient form coverage so accepted text is preserved. The padded-address read fails on the old contract pin and succeeds on the patch.
3. **M3 notify reader/persistence:** `checkChannelsAnswer` accepts the padded record; store its definition using normal ledger operations, close/reopen the ledger and read the unchanged row. Add a differential table comparing contract validation with notify's own `channelSchema("email")` on every listed email/EHLO input, asserting each literal expected boolean, including `☃: false`. Keep wire-only limits out of claims of universal parity. Padded read/persistence acceptance fails on the old pin and succeeds on the patch.
4. **M4 api writer:** authorized POST returns 201 for the padded address and both admin and service GET routes preserve its spelling. Trailing addresses and invalid EHLO inputs return 422. An over-limit report returns 422; an at-limit report is accepted; an initial failed view is empty/zero. Padded create/read acceptance fails on the old pin and succeeds on the patch.
5. **All consumers:** install from the updated lockfile, run `bun run check`, and record their full contract pin. Perform repository-required startup/browser/Compose checks without weakening CI. Console tool citations: `package.json:19`, `.github/workflows/ci.yml:231,279,291,306,308` (deploy-dev two-factor flow and Chromium browser suite). Status: `package.json:18`, `.github/workflows/ci.yml:51,66,68` (Chromium/accessibility). Retain these citations in their respective plan sections and completion evidence.

## Performance and security considerations for the plan

Contract `dist/index.js:11,18` eagerly re-exports subscription modules. A 2.4.0-to-patch pin update therefore also loads 2.5.0 code; do not assert that unused subscription imports cost zero. Earlier comments report an import A/B median of +1.4 ms CPU and +0.08 MiB RSS (30 alternating runs each); these are historical measurements, not repeated in this review. Carry rough expectations of +1–2 ms startup CPU and about +0.1 MiB RSS for api and consumers still on 2.4.0, near zero from that import delta for status already on 2.5.0 or notify after #820. Small added suites were estimated at about +0.1 s contract/notify test CPU and +0.1–0.3 s api test CPU; measure rather than promise those values.

Measure baseline/candidate startup imports and service `test_cpu_s` using user + system CPU (api `bench/measure.ts:47-71`), never wall time alone. Review all applicable `bench/budgets.json` keys, including startup, memory, test/build CPU and unaffected load/latency/cold/end-of-day metrics; give expected directions and rough magnitudes. Use the existing api bench harness/nightly measurements for service budgets where appropriate and disclose unavailable local measurements. Do not loosen budgets to pass this patch.

Security impact: **yes**. Validators sit at authenticated writes, inter-service responses and persisted definitions. Acceptance must retain secret-safe errors, strict object/size/reference checks, no-throw behavior and unchanged-object validation. The test inputs use documentation addresses and synthetic strings. No production service or private data is needed.

## Checks and limitations of this review

- Ran Bun against notify's actual `src/channels/mailer.ts` helpers with assertions for the three listed addresses and hostname, address literal, underscore, literal `☃`, `münchen.test` and NUL inputs. All matched the expected booleans. Confirmed the two emoji examples have `.length` 200 and 202.
- Inspected contract source, committed dist exports, docs, test fixtures and consumers. Full contract/consumer regression tests and `bun run check` were not run: these read-only clones have no installed dependencies, and this state changes documentation only. The issue and previous comments report pinned Zod 4.6.7 `.max()` counting code points; the plan must retain executable baseline proof rather than rely only on that report.
- Live read-only GitHub checks confirmed contract main, the open prerequisites/docs follow-up and the closed-unmerged old spec PR. Shared findings ref `factory/findings/815` returned HTTP 404 (no findings yet).
- Managed environment-status tooling and `/etc/codex/network-policy.json` are unavailable. No environment readiness is inferred. GitHub reads and the dependency-free helper checks succeeded.
- Initial attempts to read missing #815 artifacts were resolved by creating this review; guessed source/tooling paths were replaced with discovered actual paths. No target file was changed, no dependency was installed, and no provider label or comment was modified.
