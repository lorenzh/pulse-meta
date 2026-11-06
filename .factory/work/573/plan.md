# Spec #573: email subscriptions for status page visitors

Issue: [#573](https://github.com/lorenzh/pulse-meta/issues/573). Issue review:
`.factory/work/573/issue-review.md`.

## Goal

A visitor of the public status page can subscribe by email. The visitor confirms the address
through a link (double opt-in) and can unsubscribe through a link in every message. Confirmed
subscribers get an email when a public manual incident is published, gets a published update, or
is resolved. Drafts, draft updates, private notes and internal-only incidents never cause a
subscriber email. An address that has not confirmed gets only its confirmation email and no
incident email.

The public subscribe answer never tells whether an address is already subscribed or confirmed,
under any limit (R8). Subscriptions need a status page hosted at the root of its origin; a
configured path prefix is refused at startup (R9). The form shows visitors what is stored, for how
long, how to delete it and whom to contact (R10).

The feature is off by default. An installation that does not configure it starts, monitors and
notifies its operator channels exactly as before.

## Sources and decisions this spec applies

- Issue #573, its comments and the "Added requirements (manager decision after the spec review)"
  in the issue body: no address enumeration under every limit, a consistent URL prefix or a
  stated and checked root-hosting rule, and visitor information with an operator contact
  setting. R8, R9 and R10 implement them; D15-D21 record the choices. Then the "Added
  requirements (manager decision after the second spec review)": the "at most one email" of the
  notice holds per mailbox across subscription generations (D20), known, pending and unknown
  addresses get the same response-timing class below and at every limit (D22, R8), and the
  notify `Files:` list matches the files that its tasks name (notify section).
- The first spec of this feature (closed PR #814, head `55f1da0d`) passed `spec/plan-review`
  before the manager added these requirements. This spec is that version, revised. Its two
  rules that broke the new requirements are changed: notify no longer answers `429` to an
  unknown address while a known one gets `202` (row cap and global window, old R5 steps 4 and 6),
  and status no longer maps notify's answer to different public pages (old R2 table). The meta
  change of PR #814 to `docs/approved-packages.md` (mailpit in the e2e overlay) is made again in
  this spec PR.
- The issue review (`.factory/work/573/issue-review.md`, the third one, written for the second
  set of added requirements). It has no blocking question, carries decisions 1-14 of the earlier
  runs forward, and lists open points A-C and derived checks 1-14. Decisions D1-D22 below settle
  the open points; "Acceptance evidence" maps the checks.
- #460, section 12 (as quoted in the issue review): subscriber mail belongs to pulse-notify with
  its own settings, never to the console. This spec follows it. The console does not change.
- #568 (closed, complete): drafts, notes and internal incidents. Its public projection is on
  `main` and is reused here, not rebuilt: the api serves only published public incidents with
  their published updates, and notify filters private items before validation
  (`notify/src/api.ts:301-308`, `isPublicManualIncident` and `publicManualIncident` of the
  contract, `contract/src/manual-incident-public.ts`).
- #570 (in flight). Its contract child #806 is merged (contract `2.4.0`), and since the
  previous run of this spec its api child #807 and console child #808 are closed (api `main` is
  now `b6f1d53`); #809-#811 (status, notify, deploy) are open, and #815 (contract `2.4.1`, a
  patch) is open. #570
  makes status settings and notify channels editable from the console, moves the notify ledger to
  format 5, and adds an e2e scenario. Status, notify and deploy `main` do not have #570 yet. To
  stay apart from #570, this spec:
  - changes neither the notify ledger format nor the `PULSE_NOTIFY_CONFIG` file format;
  - puts every new setting in environment variables, which #570 does not report or edit;
  - takes the next contract minor version after the one on contract `main` when the contract
    child merges (D13);
  - adds its own e2e overlay and scenario, as #570 does.
  #573 does not wait for #570. A child that starts after the #570 part of its repository merged
  rebases onto it and keeps the rules above.
- The first `spec/plan-review` named three defects, and the version in PR #814 fixed them. This
  version keeps the fixes: the e2e negative mail checks wait for a detection barrier and a settled
  fan-out (deploy step "Barriers"); the fan-out pass budget is stored and survives restarts (R3
  `events.passes`, R5 "Pass budget"); and the one place where a token appears in an HTTP answer
  is defined once (R7 "Token exception") and used the same way in R2 and the security checks.
- The `spec/plan-review` of this version named two more gaps, fixed here:
  - The notice promised immediate deletion and deletion of unconfirmed data within 25 hours,
    but a confirmation job in notify's memory kept the address until a FIFO worker reached it,
    also behind a blocked send. D19 and R5 "Confirmation mail" now cancel queued jobs in the
    same step that deletes or replaces their row, drop expired jobs, bound the one attempt in
    flight, and the notice (R10) states that bound. The fan-out reads only ids per page (R5).
  - The `full` override needed `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE` through a secrets
    volume, but `secrets-init` had no path for it. D14 and the deploy section now give it one:
    an optional host file `secrets/subscriptions-smtp-password` that `secrets-init` copies to
    the notify secrets volume, with tests for its modes, its secret-free output and its absence.
- The next `spec/plan-review` named two more defects, fixed here:
  - The `config` check of the `full` override required the value
    `/run/pulse/subscriptions-smtp-password` and also forbade `password` in every environment
    value. The check now allows exactly that file path in exactly that `_FILE` key and looks for
    secret content instead (deploy checks, "`full` override").
  - The notice promised that one email can still arrive after a delete, but the confirmation
    worker and the fan-out worker could both have a send in flight for one subscriber. D20 and
    R5 "One send per subscription" now allow at most one attempt in flight per subscription
    across both workers, a confirm cancels the row's confirmation jobs, and the new
    counterexample block "Concurrent workers (D20)" tests the review's sequence (this version replaces both with the per-mailbox guard and the block "One send per mailbox (D20)"). The notice text
    is unchanged, because its bound is now true; its literal checks stay as they are.
- The next `spec/plan-review` named one more defect, fixed here: an incident send that settles
  after an unsubscribe wrote its delivery row (`sent` or `failed`) without checking that the
  subscription still exists, and the schema has no foreign key, so the late write left a delivery
  row of a deleted subscription behind, against R10. New decision D21 and R5 "Completion write"
  make every delivery write one guarded statement that inserts nothing when the subscription row
  is gone; the event still settles, because a deleted row is never eligible. Worker 1 writes
  nothing at the end of an attempt. The new counterexample block "Late completion after delete
  (D21)" holds an incident send, unsubscribes, and then settles the send with success, a
  permanent failure, a temporary failure and a timeout; each case asserts literal zero row
  counts, no retry and a `done` event.
- That version (closed PR #816, head `d83ff8d9`) passed `spec/plan-review`. The manager then added
  three more requirements to the issue body ("Added requirements (manager decision after the
  second spec review)"), and a third issue review (`.factory/work/573/issue-review.md`, open
  points A-C, checks 1-14) prepared them. This spec is the PR #816 version, revised for them:
  - **One send in flight per mailbox, across generations.** D20 now keys the shared send guard by
    the normalized address (as a keyed digest), not by the subscription row id. Unsubscribe
    followed by a fresh subscribe of the same address creates a new row, but its confirmation
    mail cannot start while a send of the old row to that address is still in flight. Worker 1
    defers such a job and serves other addresses meanwhile. The guard has an owner check, so a
    late settle cannot release a later owner's entry. New counterexample block "One send per
    mailbox (D20)", with subscribe, unsubscribe, re-subscribe and two workers. The notice keeps
    "One email that is being sent at that moment can still arrive.", because that bound now
    holds per mailbox. The manager's alternative (a weaker notice) is not taken.
  - **Response timing.** New decision D22 and R2 "Release": status writes every answer to a
    `POST /subscribe` whose address passed the address rule from one timer, registered when the
    address passed, exactly `SUBSCRIBE_RELEASE_MS` (2000 ms) later on status's injected
    scheduler. That holds whatever notify answers and when, and whether status called notify at
    all. The notify call is cut at that moment. Notify answers a valid subscribe request in the
    same synchronous step as its decision (no timer, no wait for SMTP or fan-out). New limit L9
    (at most 256 answers waiting for release) is checked before the body is read. R8 now lists
    every limit with its precedence and its timing class. New counterexample block "Response
    timing (D22)" with injected schedulers, below and at every limit, in both orders.
  - **Notify file list.** The notify `Files:` list is now the complete inventory of the notify
    tasks. It names `test/index.test.ts` and `test/metrics.test.ts` (changed) and every new
    module and test file, and each check names the file it runs in.
- The next `spec/plan-review` of this version named two defects, fixed here:
  - **Two timers of 2000 ms.** The timing test required exactly one registered `2000` ms timer,
    but the subscribe call used `requestJson` with the same scheduler and `timeoutMs = 2000`, and
    `interruptible` registers the call's own timeout timer on that scheduler in the same
    synchronous step (`contract/src/client.ts:184-185`, called from `:331-339`). The subscribe
    call now has its own timeout `SUBSCRIBE_CALL_TIMEOUT_MS = 1500`, below the release. After
    the address passed, a request that calls notify registers exactly two more timers, in this
    order: the release timer (`2000`), then the call's timeout timer (`1500`); a request skipped
    by L0 registers only the release timer then. (The full registration list, with the body
    deadline added in the same run, is `[5000, 2000, 1500]`; see the next entry.) The timing
    checks name both by delay and order. Firing the call's timer ends the call
    as a `timeout` and writes nothing; only the release writes the answer (R2 "Release", D22, R8
    "Timing", "Response timing (D22)").
  - **L9 had no reservation.** The cap counted answers waiting for release but was checked before
    the body was read, so with frozen release timers any number of slow-body requests could pass
    the check while the count was still `0`. L9 is now an admission cap: in the same synchronous
    step as the check, before any `await` and before the body is read, an admitted
    `POST /subscribe` takes one of `SUBSCRIBE_MAX_ADMITTED = 256` slots. It frees the slot exactly
    once, when its response closes, for every outcome: a refusal after admission (`415`, `413`,
    `400`, `500`), the subscribe answer at the release, or a client that goes away first. New
    counterexample "Admission (L9), partial bodies" opens 257 requests with unfinished bodies and
    expects exactly 256 admitted, then checks each way a slot is freed. The constant
    `SUBSCRIBE_MAX_WAITING` of the previous version is renamed to `SUBSCRIBE_MAX_ADMITTED`, because
    it now also counts requests whose body is still being read. Because a slot now lives while
    the body is read, a slow sender could hold it for ever: status sets no `headersTimeout` or
    `requestTimeout`, and the runtime defaults did not end an unfinished body within 3 s in a
    probe of this run. So L9 gets a body deadline, `SUBSCRIBE_BODY_TIMEOUT_MS = 5000` on the
    injected scheduler, which drops the request without an answer and so frees its slot. The
    Risks paragraph no longer relies on "the existing `headersTimeout` and `requestTimeout`".
- The next `spec/plan-review` named two more defects, fixed here:
  - **Timer counts disagreed.** R2 "Release" and R8 "Timing" still said the release timer is the
    first timer of the request and that a request registers only two timers, while R2 "Body
    deadline" and the timing tests require the registrations `[5000, 2000, 1500]` (or
    `[5000, 2000]` at L0). The text now separates **registrations** (every `schedule` call,
    cancelled ones included: `[5000, 2000, 1500]`) from **live timers** (at most `2`: the body
    deadline is cancelled before the release timer is registered). The release timer is the
    first timer registered after the address passed. Timing check 1 also asserts at most `2`
    live timers (R2 "Release", D22, R8 "Timing", "Response timing (D22)", acceptance item 11).
  - **Worker 1 could spin on an elapsed deadline.** A queued job held only by a busy mailbox
    has `notBefore = 0` (or a passed retry time), so waiting for "the earliest `notBefore`"
    could sleep `0` or less again and again. New R5 "Wake rule": worker 1 sleeps only until the
    earliest *future* `notBefore`, waits on `guard.waitFor` for each held key, never calls the
    sleep with a value below `1`, and aborts the previous round's sleep and waits before the next
    selection step. New case "Held mailbox: no elapsed wake, other mailboxes progress" in
    `test/subscriptions-mailbox.test.ts` with literal sleep records `[]`, `[1000]`,
    `[1000, 542]`, `selections` growth `0` while held, and progress of another mailbox, plus a
    self-check against a worker that sleeps until the earliest `notBefore` of all jobs.
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/573` is
  answered `HTTP 404` in this run. So there are no findings yet, which is normal for a feature
  without children.

### Clone heads read for this spec

Six of the seven clones have the same HEAD as for PR #816 (checked again in this run with
`git -C .repos/<target> rev-parse HEAD`), so the line references below hold at these SHAs. The
api clone moved to `b6f1d53` (the merge of #570's api child #807). This spec changes nothing in
the api and cites only its bench files; `api/bench/budgets.json:179-183,216-221` and
`api/bench/compose.bench.yaml:47-75` were read again at `b6f1d53` and still say what the
"Performance impact" section quotes, and `bench/run.ts:2,73` now has `--b-ref`.

| Target | HEAD | What matters here |
| --- | --- | --- |
| contract | `c5ce6685ce8b563a243823bca451032291b81adb` | version `2.4.0` (`package.json:3`); `WIRE_VERSION = 1` (`src/version.ts:5`); `ErrorResponse` at `src/schema.ts:1298` |
| status | `8b6d4315fcb989a7a8d74c063ab08d97c18a7d2d` | pins contract `9ab7e249…` (version `2.1.0`, `package.json:34`) |
| notify | `c79f0b7cb5e25ada96e6314220e69cf4f5279b32` | pins contract `9ab7e249…` (`package.json:30`), ledger format 4 (`src/ledger.ts:31`) |
| deploy | `e754d468a2c445e76d5017692096428bff179f28` | e2e on `full` or `dev`; mailpit pinned in `common/services.yaml` for the demo |
| api | `b6f1d53c7c6e819741ef853fbada637895c29e71` | read only; not changed (moved since PR #816 by #807; only bench files are cited) |
| kit | `536133f3e8b708179fa01feeb02395a0e1961e07` | status and notify pin `236df214…`, which exports `readBody`, `readJsonBody`, `sendJson`, `readSecretFile` and `escapeHtml` (checked with `gh api` at that ref, `src/index.ts:12,14,42`) |
| config | `bc870498cc8e2539a132ce2aac35a09db1deabd8` | read only; not changed |

### Current behavior (verified in the clones)

- **Status** accepts only `GET` and `HEAD`. Any other method answers `405` with
  `allow: GET, HEAD` (`status/src/server.ts:818-821`). Its CSP has `form-action 'none'`
  (`status/src/server.ts:347-360`). It sets `referrer-policy: no-referrer`
  (`status/src/server.ts:816`). The page template has no form (`status/public/index.html`). The
  settings have no subscription value (`status/src/settings.ts`). `PULSE_STATUS_PUBLIC_URL`
  is an http(s) URL without credentials, query or fragment (`status/src/settings.ts:33-48`); a
  path is allowed and a trailing `/` is removed (`status/src/settings.test.ts:93-99` accepts
  `http://h.example:8080/pulse/` as `http://h.example:8080/pulse`).
- **Status is hosted at the root of its origin today.** The page loads `/theme.css`,
  `/theme-init.js`, `/page.css` and `/client.js` by root paths (`status/public/index.html:8-10,39`),
  the feed link is `href="/feed.atom"` (`status/src/server.ts:724`), and the browser reads the api
  under `/api` (`status/src/poller.ts:173`, `status/src/server.ts:553-564`). So a prefix in
  `PULSE_STATUS_PUBLIC_URL` does not make the page work under that prefix; the value only feeds
  the absolute links of the Atom feed.
- **Status serves contract `dist` files to the browser** from a fixed list
  (`status/src/server.ts:189-206`). A test walks the import graph from `index.js` and fails on an
  unserved import (`status/src/server.contract-modules.test.ts:107-134`). So a contract bump that
  adds modules must add them to that list.
- **Notify** polls the api feeds and detects manual events by key: `manual:<id>:opened`,
  `manual:<id>:update:<digest>` (a content digest, not a position) and `manual:<id>:resolved`
  (`notify/src/detector.ts:92-161`). A 404 on `/manual-incidents` means "none" (`isAbsent`), and
  `listedIds` holds every listed id, also private or invalid ones (`notify/src/api.ts:275-310`).
  A channel without a baseline seeds the visible keys quietly (`notify/src/notifier.ts:567-600`).
- **Notify mail**: `sendMail` sends one message over one SMTP connection (`pool: false`,
  `notify/src/channels/smtp-send.ts:62-80`). A 5xx reply is a `PermanentDeliveryError`
  (`smtp-send.ts:104-117`). `MailMessage` has `from`, `to`, `envelopeTo`, `subject`, `text`,
  `date` and `messageId` (`notify/src/channels/mailer.ts:56-70`). The email channel has a fixed
  `to` list and no unsubscribe link (`notify/src/types.ts:128-136`,
  `notify/src/channels/email.ts`). So the channel cannot be reused for visitors: every recipient
  would see the others, and there is no per-recipient link.
- **Notify HTTP**: only the ops server of pulse-kit (`/healthz`, `/readyz`, `/metrics`,
  `notify/src/index.ts:259-268`). No listener takes requests from another service.
- **Notify ledger**: format 4, one SQLite file with a lease lock `<state>.lock`
  (`notify/src/ledger.ts:31`, `notify/src/ledger-lock.ts`). The image sets
  `PULSE_NOTIFY_STATE=/data/notify-state.json` (`notify/Dockerfile`).
- **Deploy**: the e2e test merges `e2e/compose.e2e.yaml` after `full` or `dev`
  (`deploy/e2e/compose-e2e.sh:14-25`). Notify's e2e channels write JSONL files
  (`deploy/e2e/notify.json`). Mailpit is pinned in `deploy/common/services.yaml` and used only by
  the demo. Secrets reach containers only through `secrets-init` (`deploy/AGENTS.md`, "Rules").
  `secrets-init.mjs` writes probe, admin and console secrets only
  (`deploy/scripts/secrets-init.mjs:1-14`); notify gets no secrets volume in `full`
  (`deploy/full/compose.yaml:73-80`), and no setup provisions an SMTP password today. A host
  input file must be regular, not a symlink, without group or other bits
  (`readHostFile`, `secrets-init.mjs:42-56`). CI job `e2e-dev` requires two `ok:` lines
  (`deploy/.github/workflows/ci.yml:304-306`).
- **meta**: `docs/approved-packages.md:58` approves mailpit for the `demo` setup only.

## Decisions

- **D1 Owner: notify stores subscriptions and sends all subscriber mail.** Notify already polls the
  public feeds with the privacy filters of #568, detects manual events with stable keys, and has
  SMTP. A second database in the api would need a private api for recipient lists and a way to
  hand raw confirmation tokens from the api to notify. Notify keeps subscriptions in **its own new
  SQLite file**, separate from the ledger, so the ledger format (and #570's format 5) does not
  change. The api does not change. No service reads another service's file.
- **D2 Status serves the public forms; notify serves a private HTTP listener.** The browser only
  ever talks to status. Status forwards the three operations to notify over HTTP with a bearer
  token. The notify listener is a new port, off unless subscriptions are on. The wire shapes are
  in the contract.
- **D3 Only manual incidents are mailed.** "Incident updates" in the issue are what an operator
  publishes: a manual incident's publication, its published updates and its resolution.
  Automatic check incidents are not mailed to subscribers. Reasons: the status page labels them
  by status settings that notify does not know (`hideDetails`, `showChecks`,
  `status/src/components-view.ts:141-163`), their reason text can hold internal detail, and they
  can flap. Reminders and warning events (budget, TLS, domain) are not mailed either. This
  narrows the issue review's assumption 3. Mailing automatic incidents is a later issue.
- **D4 Every eligible event is mailed.** No per-publication "notify subscribers" toggle. The
  composer label of the design is context. So the api and the console do not change (issue
  review, assumption 4).
- **D5 Future events only, by notify's own clock.** A subscription gets an event when it was
  confirmed at or before the time notify first detected the event (`confirmed_at <=
  detected_at`, both from notify's injected clock). No history is replayed at confirmation. A
  later update or resolution of an incident that was open at confirmation is a new event and is
  mailed. This avoids clock skew between the api and notify, and does not depend on the `at` of a
  draft update.
- **D6 First enablement seeds quietly.** When the subscription store has no manual baseline, the
  first good, non-404 manual read stores the keys of every visible manual event as `seeded` and
  sends nothing. This is the same rule as a new channel (`notify/src/notifier.ts:567-600`).
- **D7 Lifecycle: `pending` and `confirmed` rows; unsubscribe deletes.** A subscription is one row
  with a random id. Unsubscribe deletes the row and its delivery rows in one transaction, so a
  cancelled address is not stored (the store runs with `PRAGMA secure_delete = ON` and checkpoints
  its WAL after each delete, R3). A later subscribe creates a new row with a new id and needs a
  new confirmation. Tokens of the old row can never act on the new row.
- **D8 Tokens.**
  - Confirmation token: 32 random bytes, base64url without padding (43 characters). Notify
    stores only its SHA-256 hex digest. It is valid for 24 hours after the last confirmation mail
    of the row. It works while the row is `pending`. On a `confirmed` row the same token answers
    `confirmed` again (a harmless repeat) and changes nothing. A new confirmation mail for the
    same row replaces the digest, so older confirmation links stop working.
  - Unsubscribe token: `<id>.<mac>`. `id` is the row id (16 random bytes, base64url, 22
    characters). `mac` is base64url of HMAC-SHA256 with the subscription key over the bytes of
    `pulse-unsubscribe:<id>` (43 characters). Notify stores no unsubscribe token. The link works
    for the whole life of the row, also after the confirmation link expired. The check uses
    `timingSafeEqual`.
- **D9 Commit only on POST.** A link in a mail opens a status page (`GET`) with a button. Only the
  `POST` of that button confirms or unsubscribes. A link scanner or `HEAD` changes nothing.
- **D10 Links use one configured origin, and subscriptions need root hosting.** Notify builds links
  from `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL`, never from a request header or a visitor value.
  Links are `<origin>/subscribe/confirm?token=…` and `<origin>/unsubscribe?token=…`. The
  manager allowed either a kept prefix or a stated and checked root rule; this spec takes the root
  rule (R9). Reason: the status page itself is root-hosted today (root paths for its CSS,
  scripts, feed and api, "Current behavior"), so subscription pages under `/pulse` would sit next
  to a page that does not work there. Supporting a prefix for the whole page is a separate
  feature; when it lands, it lifts R9's refusal for status and notify together.
- **D11 Delivery is at least once, per subscriber.** Each confirmed subscriber gets its own message
  with only its own address in `To`. Progress is stored per event and subscription. A crash
  after SMTP accepted a message and before the progress write can send that message once more;
  its `Message-ID` is the same, so a receiver can drop the copy. Exactly once is not promised.
- **D12 An unsubscribe answered before a send starts stops that send.** Notify re-reads the row
  right before each SMTP send, in the same process and without an `await` between the read and
  the start of the send. A send attempt that already started finishes or times out; it is not
  aborted, because the message may already be with the mail server. Every subscriber send
  attempt (confirmation and incident) has the timeout `min(PULSE_NOTIFY_TIMEOUT_MS, 60000)`
  (the whole-attempt timer of `sendMail`, `notify/src/channels/smtp-send.ts:207-211`), so an
  attempt in flight holds an address for at most 60 s after a delete. The same synchronous step
  also checks and takes the mailbox guard of D20.
- **D13 Contract version.** The contract change is additive: a new minor version, `WIRE_VERSION`
  stays `1`. Its version is the next minor after the version on contract `main` when it merges:
  `2.5.0` on today's `main` (`2.4.0`, #806 merged), also when #815's `2.4.1` merges first.
- **D14 Secrets through `secrets-init`.** The bearer token between status and notify and the HMAC
  key are two new host secrets. `scripts/init-secrets.sh` creates them, and `secrets-init` copies
  them into new status and notify secret volumes only when `PULSE_SECRETS_SUBSCRIPTIONS=on`.
  The SMTP password of the subscriber mail is a third, optional host secret,
  `secrets/subscriptions-smtp-password`, that the operator writes (it comes from the mail
  provider, so `init-secrets.sh` never creates it). With `PULSE_SECRETS_SUBSCRIPTIONS=on`,
  `secrets-init` checks it when it exists and copies it to the notify secrets volume as
  `subscriptions-smtp-password`; when it does not exist, it writes no password and removes a
  copy left by an earlier run. This is the only supported way to give notify that password in
  the deploy setups (deploy `AGENTS.md`, "Rules": secrets only through `secrets-init`).
- **D15 One public answer for every valid address.** Status answers every `POST /subscribe` whose
  address passes the address rule with the same `200` page, whatever notify answered (`202`,
  `503`, a timeout, a network error, a bad body) and whether status called notify at all (its
  in-flight cap). Notify answers every valid subscribe request with `202 {"status":"accepted"}`,
  for an absent, pending or confirmed address and under every limit; it refuses work silently.
  The page text does not promise a mail. The checks that come before the address (origin, content
  type, size, form fields, address rule) give fixed answers that do not depend on the store
  (R8).
- **D16 No per-requester limit.** Status runs behind proxies whose client address it cannot
  trust (it never reads `X-Forwarded-*`, R2), so it has no per-IP limit. The bounds are global:
  status's in-flight cap and its admission cap (L9, with its body deadline), notify's per-address
  cooldown and send cap, the global hourly window, the confirmation queue and the row and pending
  caps (R8 table). A flood can fill the window and
  delay real visitors' confirmation mails for up to an hour; it cannot grow the store past its
  caps or reveal membership.
- **D17 Visitor notice and operator contact.** Status shows a fixed notice under the form (R10)
  with the configured contact `PULSE_STATUS_SUBSCRIPTIONS_CONTACT` (an email address or an `https`
  URL), required when subscriptions are on. The notice states exactly the data that notify keeps
  (R10 inventory) and the times of R3 "Cleanup", which come from contract constants that both
  services use. The SMTP sender is not used as the contact.
- **D18 Operator deletion without a link.** `pulse-notify subscribers delete <address>` deletes a
  subscription by address while the service is stopped, under the store lock, like `failed
  resend` (`notify/src/index.ts:350-380`). The visitor asks the contact; the operator runs the
  command. Deleted rows are overwritten in the live database (`secure_delete`, a WAL checkpoint);
  copies in backups, in mailboxes and at mail providers are outside Pulse and the notice says so.
- **D19 A delete reaches the confirmation queue at once.** Worker 1's queue lives in notify's
  memory and holds the address and the raw tokens of each job. Every transaction that deletes a
  `subscriptions` row (unsubscribe, cleanup, the expired-row step of subscribe) or replaces its
  confirmation digest (a new confirmation mail) removes that row's queued jobs from the queue in
  the same synchronous step after the commit, before the operation answers. This does not wait
  for the worker: a job behind a blocked send is removed while that send stays blocked. A job
  whose link expired, or whose row is already `confirmed`, is dropped too (R5 "Confirmation
  mail"). A confirm cancels the row's queued jobs the same way, so a confirmed row gets no
  further confirmation attempt. The one attempt already in flight is the only exception (D12,
  D20); the notice says that one email can still arrive (R10).
- **D20 At most one subscriber send in flight per mailbox, across both workers and every
  generation.** Worker 1 (confirmation mail) and worker 2 (incident fan-out) run independently.
  A guard keyed by the subscription row id (the PR #816 version) stops two sends to one row, but
  not two sends to one mailbox: an incident send to row M1 is in flight, the visitor unsubscribes
  (M1 is deleted) and subscribes again at once (new row M2, same address), and M2's confirmation
  mail starts while M1's send is still open. Two emails would then be in flight for the address
  after the delete, and the notice's "One email" would be false. So notify keeps one in-memory map
  `inFlight` from a **mailbox key** to the attempt in flight for that mailbox, shared by both
  workers (R5 "One send per mailbox"):
  - The mailbox key is `HMAC-SHA256(salt, address)` in hex, where `address` is the stored
    address (already normalized by `normalizeSubscriberEmail`, so `Sub-A@E2E.invalid` and
    ` sub-a@e2e.invalid` have one key) and `salt` is 32 random bytes made at process start and
    never stored, logged or exported. The map never holds a raw address. No provider rule (dots,
    `+` tags, DNS aliases) is applied: two addresses are one mailbox exactly when they normalize
    to the same string, the same rule as the `UNIQUE` column of the store.
  - A worker starts an attempt only when the map has no entry for the key. It reads the row,
    checks eligibility, checks the map, adds its entry `{ owner, settled }` and calls `sendMail`
    in one synchronous step (no `await` between them, D12). The entry is removed when that
    attempt settles (success, any error, the D12 timeout, or the abort at stop), and only by
    its own owner: a release whose `owner` differs from the entry's does nothing. No delete,
    cancel, confirm or re-subscribe removes or replaces an entry.
  - Worker 2, finding an entry, waits for it to settle (at most 60 s, D12; stop ends the wait)
    while holding only the row id and the key, then re-reads the row by id. Worker 1, finding an
    entry for a job's key, leaves that job queued and sends the next ready job of another
    mailbox; the deferred job is checked again (row, digest, expiry) when the entry settles.
    So a busy mailbox never blocks other mailboxes in worker 1.
  - The store lock (R3) makes one notify process the only writer and sender of a store, so an
    in-memory guard in that process covers every subscriber send of that store. It does not
    coordinate two notify processes with two stores, and it does not cover the operator email
    channel, which is configured apart and may send to the same mailbox.
  So at any moment at most one subscriber email to a mailbox is in flight, whatever the order of
  subscribe, confirm, detection, unsubscribe and re-subscribe, and a delete leaves at most one
  email that can still arrive. This is the bound the notice states. The manager's alternative, a
  weaker notice, is not taken: the per-mailbox bound costs one map key and is testable.
- **D21 A send that settles after a delete writes nothing.** A send attempt in flight is not
  aborted (D12), so it can settle after the unsubscribe (or `subscribers delete`, cleanup) has
  committed. Its outcome must not bring back data of the deleted row. Every delivery write is one
  `INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM subscriptions WHERE id = ?)` statement (R5
  "Completion write"): the existence check and the insert are one atomic statement on the store's
  one connection (`bun:sqlite` is synchronous, so no unsubscribe transaction can run between
  them). When the row is gone, nothing is inserted, and the event still settles: a deleted row is
  never eligible, so step 4 of the pass budget finds no subscription left and no further pass or
  sleep is started for it. Row ids are 16 random bytes and never reused (D7), so a new row of the
  same address (a later subscribe) is not matched by the old send. Worker 1 writes nothing to the
  store when an attempt settles (only counters and the gauge change), so a late confirmation
  attempt cannot recreate data either. A foreign key is not added: the guard covers every writer,
  and a foreign key would turn a late write into a constraint error instead of a skip.
- **D22 One release time for every valid subscribe answer.** Equal bytes do not hide membership
  when a known address is answered earlier or later than an unknown one. So status answers every
  `POST /subscribe` whose address passed the address rule from one timer: it registers that
  timer on its injected scheduler, with the delay `SUBSCRIBE_RELEASE_MS = 2000` (a status
  constant), in the same synchronous step in which the address passed and before it calls
  notify, and it writes the answer only when that timer fires. Nothing else writes that answer:
  not notify's reply, not its error, not the end of the call. The notify call has its own,
  shorter timeout `SUBSCRIBE_CALL_TIMEOUT_MS = 1500` (a status constant; `requestJson` registers
  it on the same scheduler, `contract/src/client.ts:184-185`), so the release timer and the
  call's timeout differ by delay and by order (with the body deadline of R2, which is cancelled
  before the release timer is registered, the registrations are `[5000, 2000, 1500]`; at most
  two of them are live at once, R2 "Release"), and it gets an abort signal that fires at the release, so it never outlives the
  answer even when a scheduler never fires its timeout. The answer is the one
  subscribe answer of D15. This is the **release class** of the public route: the answer starts
  `SUBSCRIBE_RELEASE_MS` after the address passed, on status's clock, for a confirmed, pending or
  unknown address, below and at every limit. Requests refused before the address is read (origin,
  L9, content type, size, form fields, address rule) are answered at once, by their own bytes
  only. Notify's side has the **immediate class**: a valid subscribe request is answered in the
  same synchronous step as its decision, with no timer and no wait for SMTP, the confirmation
  queue or the fan-out, also at every limit; its time therefore does not depend on membership
  beyond one SQLite lookup and at most one small write, and status hides even that behind the
  release. The tests check both classes with injected schedulers (block "Response timing
  (D22)"). This spec does not claim equal network, kernel or CPU timing; it claims that no code
  path waits or answers differently by membership. 2000 ms is above notify's immediate answer
  plus a local HTTP round trip by a wide margin and short enough for a form submit.

## Scope

- contract: the wire shapes and limits of the three subscription operations, the address rule,
  the token formats and the two retention times that the notice states.
- status: the subscribe form with the visitor notice and contact, the confirm and unsubscribe
  pages, the three `POST` routes with one public subscribe answer, the call to notify, the root
  hosting rule, settings and docs.
- notify: settings with the root hosting rule, the subscription store, the private listener,
  confirmation mail, detection and fan-out of manual events to confirmed subscribers, cleanup,
  the `subscribers delete` command, metrics and docs.
- deploy: `secrets-init` and `init-secrets.sh` for the two secrets, `secrets-init` for the
  optional SMTP password, an operator override for `full`, a test-only overlay with
  mailpit, an e2e scenario that reads real mail and compares known and unknown addresses below
  and at capacity, CI and docs.
- meta (this spec PR): `docs/approved-packages.md` allows the pinned mailpit in the test-only e2e
  overlay too.

## Non-goals

- Mail for automatic incidents, reminders and warnings (D3).
- A per-publication toggle, console screens for subscribers, a subscriber list or export, any api
  change.
- Component selection, several pages, SMS, digests, accounts, a visitor dashboard.
- The `List-Unsubscribe` and `List-Unsubscribe-Post` mail headers (RFC 2369, RFC 8058). The
  body link is the unsubscribe path that the issue asks for. The headers are a later change.
- Non-ASCII (internationalized) addresses (rejected by the address rule).
- A `failed resend` for subscriber mail. The notify CLI keeps working on ledger entries only.
- Turning subscriptions on in `full`, `minimal`, `demo` or `dev` by default.
- Persisting confirmation mails across a notify restart (D-R5 below).
- Hosting status or its subscription pages under a path prefix (D10, R9). A prefixed
  `PULSE_STATUS_PUBLIC_URL` keeps working with subscriptions off, exactly as today.
- A per-requester (per-IP) rate limit (D16), CAPTCHAs, and claims of equal network, kernel or
  CPU timing. The timing rule is the release class of D22, checked with injected schedulers.
- Coordinating subscriber mail with the operator email channel, or across two notify processes
  with separate stores (D20).
- A subscriber list, count or lookup on any public route; legal advice on a jurisdiction's privacy
  law. The notice describes what the software does.

## Required behavior

### R1 Contract shapes (all in a new contract module)

Routes of the notify listener (`SUBSCRIPTION_ROUTES`):

| Route | Method | Body | Answers |
| --- | --- | --- | --- |
| `/subscriptions` | `POST` | `SubscriptionRequest` `{ "email": string }` | `202 {"status":"accepted"}` for every valid request (D15); `400`, `401`, `413`, `415`, `503` with `ErrorResponse`. Never `429`, never `404`, never a body that depends on the store. |
| `/subscriptions/confirm` | `POST` | `SubscriptionTokenRequest` `{ "token": string }` | `200 {"status":"confirmed"}`; `400`, `401`, `404`, `413`, `415`, `503` with `ErrorResponse` |
| `/subscriptions/unsubscribe` | `POST` | `SubscriptionTokenRequest` `{ "token": string }` | `200 {"status":"unsubscribed"}`; `400`, `401`, `404`, `413`, `415`, `503` with `ErrorResponse` |

- `SUBSCRIPTION_MAX_BODY_BYTES = 1024`: the largest request body of these routes.
- `SUBSCRIPTION_CONFIRM_TTL_MS = 86400000` (24 hours): how long a confirmation link works and how
  long an unconfirmed row lives after its last confirmation mail.
- `SUBSCRIPTION_CLEANUP_INTERVAL_MS = 3600000` (1 hour): the period of notify's cleanup (R3).
  Status renders both values in the notice (R10) and notify uses them; neither is a setting.
- `SUBSCRIBER_EMAIL_MAX = 254`: the longest address after normalization.
- `SubscriptionRequest`: strict object with one key `email`, a string for which
  `normalizeSubscriberEmail(email) === email`. So only the normalized form is valid on the wire.
- `SubscriptionTokenRequest`: strict object with one key `token`, a string of at most 128
  characters. The route decides which pattern applies:
  - `SUBSCRIPTION_CONFIRM_TOKEN_PATTERN` = `^[A-Za-z0-9_-]{43}$`;
  - `SUBSCRIPTION_UNSUBSCRIBE_TOKEN_PATTERN` = `^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$`.
- `SubscriptionAnswer`: strict object `{ "status": SubscriptionResult }` with
  `SUBSCRIPTION_RESULTS = ["accepted", "confirmed", "unsubscribed"]`.
- Errors use the existing `ErrorResponse` (`contract/src/schema.ts:1298`).
- `normalizeSubscriberEmail(value: unknown): string | undefined`. It never throws. Rules, in this
  order:
  1. not a string: `undefined`;
  2. remove leading and trailing spaces and tabs (U+0020, U+0009) only;
  3. every remaining character is in U+0021..U+007E, else `undefined` (so CR, LF, NUL, spaces
     inside, and non-ASCII are rejected);
  4. exactly one `@`;
  5. local part: 1..64 characters from ``A-Z a-z 0-9 ! # $ % & ' * + / = ? ^ _ ` { | } ~ . -``; not
     starting or ending with `.`; no `..`;
  6. domain: 1..253 characters; at least two labels split by `.`; each label 1..63 characters of
     `A-Z a-z 0-9 -`, not starting or ending with `-`; the last label is not all digits (so no
     IP address); no `[` literal;
  7. the result is the whole address in lower case, at most `SUBSCRIBER_EMAIL_MAX` characters,
     else `undefined`.
- Validators `validateSubscriptionRequest`, `validateSubscriptionTokenRequest`,
  `validateSubscriptionAnswer` return `Validation<T>` and never throw, like
  `contract/src/validate-tokens.ts`.

### R2 Status: page, forms and routes

The exact notice text and the contact rule are in R10; the root rule is in R9; the reasons for
one subscribe answer are in R8.

Subscriptions are on in status when `PULSE_STATUS_SUBSCRIPTIONS_URL` is set (R6). When off, status
answers exactly as today: no form, `405` for every non-`GET`/`HEAD` request, `404` for the new
paths, `form-action 'none'`.

When on:

- **Form.** The page has a section after "Maintenance" (`status/public/index.html:37-38`):
  `<section id="subscribe" aria-labelledby="subscribe-title">` with the heading
  `<h2 id="subscribe-title">Get incident updates by email</h2>`, a
  `<form method="post" action="/subscribe">`, a visible
  `<label for="subscribe-email">Email address</label>`, `<input id="subscribe-email"
  name="email" type="email" autocomplete="email" required maxlength="254">`, a
  `<button type="submit">Subscribe</button>`, the line `We send a confirmation link first. Every
  email has a link to unsubscribe.`, and the visitor notice of R10. In document order the notice
  comes after the input and before the button, so a screen reader or keyboard user meets it
  before submitting; the input has `aria-describedby="subscribe-notice"`. It works without
  JavaScript. The client poller does not touch it.
- **CSP.** `form-action 'self'` on every answer. Everything else of the CSP stays.
- **Pages.** Each result page is server-rendered HTML with the page's title, wordmark, theme and
  CSS, `cache-control: no-store`, the headers of today (CSP, `x-content-type-options`,
  `x-frame-options`, `referrer-policy: no-referrer`), and a link back to `/`. All text from a
  request is escaped with `escapeHtml`. No page echoes a submitted address (the only address on a
  page is the operator contact of R10). No page echoes a token, with
  one exception (R7 "Token exception"): the `200` answer of `GET /subscribe/confirm` and
  `GET /unsubscribe` holds the request's own, pattern-checked token once, as
  `<input type="hidden" name="token" value="<token>">`. Every other answer, including the
  `400` invalid-link pages and every `POST` result page, holds no token.
- **Routes.**

| Request | Checks, in this order | Answer |
| --- | --- | --- |
| `POST /subscribe` | origin (below) → `403`; 256 subscribe requests already admitted (L9, below) → `503`, the body is not read; else the request takes an admission slot in the same synchronous step (L9); `content-type` not `application/x-www-form-urlencoded` (parameters allowed) → `415`; body over 2048 bytes → `413`; fields not exactly one `email` → `400`; `normalizeSubscriberEmail` fails → `400` with the form and the error `Enter a valid email address.`; then register the release timer (below), then call notify, unless status's in-flight cap is full (below) | always the same `200` page, the "subscribe answer" below, written when the release timer fires, for every notify outcome: `202`, `400`, `401`, `503`, any other code, a `3xx`, a timeout, a network error, a wire version mismatch, an invalid body, no answer before the release, or no call because of the in-flight cap (D15, D22, R8). |
| `GET` or `HEAD /subscribe/confirm?token=<t>` | exactly one `token` that matches `SUBSCRIPTION_CONFIRM_TOKEN_PATTERN`, else `400` page `This link is not valid. Request a new one on the status page.` | `200` page with `<form method="post" action="/subscribe/confirm">`, a hidden `token`, and `<button type="submit">Confirm subscription</button>`. No notify call. |
| `POST /subscribe/confirm` | origin → `403`; content type → `415`; size → `413`; exactly one `token` with the confirm pattern, else `400` (invalid-link page); call notify | `200` → `200` page `Your subscription is confirmed.`; `404` → `400` page `This link is not valid or has expired. Request a new one on the status page.`; anything else → `503` |
| `GET` or `HEAD /unsubscribe?token=<t>` | one `token` with the unsubscribe pattern, else `400` invalid-link page | `200` page with `<form method="post" action="/unsubscribe">`, hidden `token`, `<button type="submit">Unsubscribe</button>` |
| `POST /unsubscribe` | origin → `403`; content type → `415`; size → `413`; one `token` with the unsubscribe pattern, else `400`; call notify | `200` → `200` page `You are unsubscribed. You get no more emails.`; `404` → `400` invalid-link page; anything else → `503` |

- **Subscribe answer.** Status `200`, the result page with the heading `Check your inbox` and the
  text `If this address can be subscribed, we send it a confirmation link. The link works for 24
  hours. If no email arrives within an hour, try again later or contact <contact link of R10>.`
  The bytes of this answer (status line, headers other than `date`, body) are the same for every
  request that reaches it: no address, no token, no `Location`, no `Retry-After`, no
  `Set-Cookie`, no `ETag`, no notify detail. `content-length` is therefore equal too. "24 hours"
  is rendered from `SUBSCRIPTION_CONFIRM_TTL_MS`.
- **Release** (D22). When the address passed the rule, status reads `t0 = now()` and, in the
  same synchronous step, registers one timer with `schedule(release, SUBSCRIBE_RELEASE_MS)`
  (`SUBSCRIBE_RELEASE_MS = 2000`, a constant exported by `src/subscribe-routes.ts`; `schedule` is
  a new `ServerOptions` member with the type of the contract's `FetchJsonOptions.schedule`,
  `contract/src/client.ts:40-41`, default `setTimeout` with a cancel). Only then does it start
  the notify call, which registers one more timer on the same scheduler, in the same synchronous
  step: the call's timeout of `SUBSCRIBE_CALL_TIMEOUT_MS = 1500` (also exported by
  `src/subscribe-routes.ts`; `interruptible` calls `schedule` inside the `Promise` executor,
  `contract/src/client.ts:177-191`, so before `fetch` runs). This spec counts timers in two ways,
  and the tests check both:
  - **Registrations** (every `schedule` call of the request, cancelled ones included, in order).
    A request that passed the address rule and calls notify registers exactly three timers:
    the body deadline `5000` (below, registered after the content-type check and cancelled when
    the body ended), then the release timer `2000`, then the call's timeout `1500`. So the
    registration list is `[5000, 2000, 1500]`; a request skipped by L0 registers
    `[5000, 2000]`. The release timer is the first timer registered *after the address passed*,
    and the call's timeout is the last timer of the request.
  - **Live timers** (registered and neither fired nor cancelled). The body deadline is cancelled
    before the release timer is registered, so a request never has more than two live timers:
    the release timer and the call's timeout while the call is open, the release timer alone
    for an L0 request or after the call ended.
  When the call's timer fires, the call ends as `timeout`
  (logged as R2 "Notify call") and nothing is written. `release` aborts the call's signal (a
  no-op when the call already ended), frees the call's in-flight slot if it still holds one, and
  writes the subscribe answer. No other code path writes an answer for a request that reached
  this point: not the call's end, not its timeout timer. When the client closes the connection
  before the release, status cancels the release timer, aborts the call (whose `finally`
  cancels its timeout timer, `contract/src/client.ts:187-190,206-207`) and writes nothing. Status keeps
  no address after the call was built: the timer closure holds the response object and the abort
  controller only.
- **Admission cap (L9).** At most 256 `POST /subscribe` requests are admitted at once (a status
  constant, `SUBSCRIBE_MAX_ADMITTED = 256`). "Admitted" covers a request from the moment it
  passed the origin check, while its body is read, while it waits for its release, until its
  response closes. The check and the reservation are one synchronous step at the start of the
  route, after the origin check and before the first `await` of the request and before any body
  byte is read: when `admitted >= 256` the request gets at once `503` with the page `The status
  page is busy. Try again in a minute.` and `cache-control: no-store`, takes no slot, and status
  logs `subscription request refused (busy)` (no address) at most once per minute; otherwise
  status increments `admitted` and attaches one `res.once("close", free)`. `free` decrements
  `admitted` exactly once per admitted request (a per-request flag guards it, so a second call
  is a no-op). Node's `ServerResponse` emits `close` both after an answer has been sent and when
  the connection ends before that (checked on Bun 1.4.0 with `node:http` in this spec run:
  `res.writableEnded` is `true` in the first case and `false` in the second), so every outcome
  of an admitted request frees its slot: a `415`, `413`, `400` (fields or address) or `500`
  answer, the subscribe answer at the release, a client that closes the socket during the body
  or during the wait, and a body read error that destroys the request. No path frees the slot
  earlier than the close of its own response, and no other code changes `admitted`. Two requests
  that arrive together are handled one after the other by the event loop, so the 257th request
  always sees the 256 slots taken by earlier ones, whatever their bodies do. This answer depends
  only on the number of admitted requests, never on an address, and `POST /subscribe/confirm` and
  `POST /unsubscribe` are not counted or refused by it.
- **Body deadline** (part of L9). A slow sender must not hold a slot for ever: status sets neither
  `headersTimeout` nor `requestTimeout` (`grep -rn 'headersTimeout\|requestTimeout'
  .repos/status/src` finds nothing), and a probe in this spec run on Bun 1.4.0 and Node 24 with
  `requestTimeout = 1000` still had an unfinished body open after 3 s. So, after the content-type
  check passed and before the size check and the first body byte, status registers one timer
  `schedule(dropSlowBody, SUBSCRIBE_BODY_TIMEOUT_MS)` (`SUBSCRIBE_BODY_TIMEOUT_MS = 5000`, exported
  by `src/subscribe-routes.ts`) and cancels it when the body has ended, when the request is
  answered `413` (also when a `content-length` over 2048 is refused before reading), or when the
  response closed.
  When it fires, status destroys the request without writing a byte; the response's `close` then
  frees the slot. A `403`, `503` or `415` registers no timer at all. The body timer is always
  cancelled before the release timer is registered, so it never touches the answer of a request
  that passed the address rule.
- **In-flight cap (L0).** At most 8 notify calls of `POST /subscribe` run at once (a constant of
  status, not a setting). A request that finds 8 in flight makes no call and gets the subscribe
  answer at its release, like every other valid request; status counts it in a log line
  `subscription request skipped` (no address) at most once per minute. The cap does not depend on
  the address, and confirm and unsubscribe calls do not use it.
- `POST` to any other path still answers `405` with `allow: GET, HEAD`. `GET /subscribe` answers
  `404` as today.
- **Origin check.** When the request has an `Origin` header, it must equal the origin of
  `PULSE_STATUS_PUBLIC_URL` (scheme, host and port; R9 makes that URL an origin), else `403`. `Origin: null` is a mismatch.
  When there is no `Origin` but a `Sec-Fetch-Site` header, it must be `same-origin` or `none`,
  else `403`. With neither header the request goes on (no-JS browsers, curl). Status never
  reads `Host`, `X-Forwarded-*` or `Referer` for this.
- **Notify call.** `requestJson` of the contract (`contract/src/client.ts:331-341`) with
  `method: "POST"`, the body `JSON.stringify(...)` of the validated shape,
  `Authorization: Bearer <token>`, `maxBytes: 4096`, `validate` = `validateSubscriptionAnswer`,
  and `schedule` = the server's `schedule`. For confirm and unsubscribe, `timeoutMs` =
  `PULSE_STATUS_UPSTREAM_TIMEOUT_MS`. For subscribe, `timeoutMs` = `SUBSCRIBE_CALL_TIMEOUT_MS`
  (`1500`) and `signal` = the release's abort signal (`RequestJsonOptions` at
  `contract/src/client.ts:231-235` keeps `signal` and `schedule` of `FetchJsonOptions`, `:33-41`),
  so the call ends after 1500 ms by its own timer, and at the release at the latest when a
  scheduler fires the release first. A non-`2xx` answer, a timeout, a network error, a wire version
  mismatch or an invalid body is mapped by the table above (for `/subscribe` always to the
  subscribe answer, written at the release, never earlier). The notify URL is never followed through a redirect (a `3xx` is an error).
  Status logs the failure kind and route, never the address, the token or the notify URL's
  credentials. The failure kind is one of `status <code>`, `timeout`, `network`, `version`,
  `invalid body`. Logs are for the operator, who can read the store anyway; they never reach the
  visitor.

### R3 Notify: settings and store

- Settings (env, read with the pulse-kit readers; secrets with `readSecretFile`):

| Variable | Default | Rule |
| --- | --- | --- |
| `PULSE_NOTIFY_SUBSCRIPTIONS` | `off` | `on` or `off`. Everything below is read only when `on`. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL` | required | http(s) URL without credentials, query or fragment, and without a path other than `/` (R9); a trailing `/` is removed, so the value is an origin. It must equal status's `PULSE_STATUS_PUBLIC_URL` after the same normalization (deploy feeds both from one variable). |
| `PULSE_NOTIFY_SUBSCRIPTIONS_FROM` | required | single-line address, the same rule as a channel `from` (`notify/src/channel-schema.ts:32-39`). |
| `PULSE_NOTIFY_SUBSCRIPTIONS_SUBJECT_PREFIX` | `[<host of STATUS_URL>]` | single line, 1..64 characters. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_HOST` | required | the `smtp.host` rule (`channel-schema.ts:88-93`). |
| `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PORT` | `587` | 1..65535. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_TLS` | `starttls` | `starttls`, `tls` or `none`. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_USERNAME` | unset | single line. With a username, `SMTP_TLS=none` is refused unless the host is loopback (the channel rule, `notify/src/config.ts:139-142`), and the password file is required. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE` | unset | read once at startup with `readSecretFile` (one line, trimmed, not empty; `kit/src/secret-file.ts:21-41`, equal at the pin `236df214`); set only together with a username, else exit `2` (the channel rule, `notify/src/config.ts:133-136`). The deploy setups point it at `/run/pulse/subscriptions-smtp-password` (D14). |
| `PULSE_NOTIFY_SUBSCRIPTIONS_TOKEN_FILE` | required | the bearer token of status; one line, at least 32 printable ASCII characters. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_KEY_FILE` | required | the HMAC key; exactly 64 lowercase hex characters (32 bytes). |
| `PULSE_NOTIFY_SUBSCRIPTIONS_HOST` | `127.0.0.1` | listener address. The image sets `0.0.0.0`. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_PORT` | `9300` | listener port. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_STATE` | `<directory of PULSE_NOTIFY_STATE>/notify-subscriptions.db` | the store file. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_MAX` | `10000` | 1..100000: the most rows (pending plus confirmed). |
| `PULSE_NOTIFY_SUBSCRIPTIONS_MAX_PENDING` | `1000` | 1..100000 and at most `PULSE_NOTIFY_SUBSCRIPTIONS_MAX`: the most `pending` rows. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_CONFIRM_PER_HOUR` | `100` | 1..10000: the most confirmation mails queued in any 3600 s. |

  A bad value fails startup with exit `2` and one line that names the variable, never its value
  or a file's content. Every setting is read and checked before any file is opened, so a refused
  start creates no store, lock or listener. With `off`, no listener, store, lock or worker
  starts.
- `PULSE_NOTIFY_SMTP_CLIENT_NAME` and the retry settings (`PULSE_NOTIFY_RETRY_*`) also apply to
  subscriber mail. `PULSE_NOTIFY_TIMEOUT_MS` (default `5000`, `notify/src/config.ts:402`) applies
  capped at 60000 ms: a subscriber send attempt has the timeout
  `min(PULSE_NOTIFY_TIMEOUT_MS, 60000)` (D12).
- **Store**: a SQLite file (`bun:sqlite`, WAL, `synchronous = FULL`, `secure_delete = ON`),
  created with mode `0600` under its own lease lock `<store>.lock` (the existing `acquireLock`,
  `notify/src/ledger-lock.ts`). After every transaction that deletes a `subscriptions` row
  (unsubscribe, cleanup, `subscribers delete`) the store runs `PRAGMA wal_checkpoint(TRUNCATE)`,
  so the deleted content is overwritten in the main file and the WAL is emptied; a checkpoint
  that cannot finish (busy) is retried at the next cleanup and logged as a warning without an
  address. Shutdown checkpoints too.
  `PRAGMA user_version = 1`. Tables:
  - `subscriptions(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK
    (state IN ('pending','confirmed')), created_at INTEGER NOT NULL, confirm_digest TEXT UNIQUE,
    confirm_expires_at INTEGER, confirm_sends INTEGER NOT NULL, last_sent_at INTEGER,
    confirmed_at INTEGER)`;
  - `events(key TEXT PRIMARY KEY, manual_id INTEGER NOT NULL, status TEXT NOT NULL CHECK (status
    IN ('seeded','pending','done')), detected_at INTEGER NOT NULL, payload TEXT, settled_at
    INTEGER, passes INTEGER NOT NULL DEFAULT 0, next_pass_at INTEGER)`. `passes` is the number
    of fan-out passes started for the event; `next_pass_at` is the earliest start of the next
    pass (`NULL` before the first pass). Both are durable, so a restart never resets the pass
    budget (R5 "Pass budget");
  - `deliveries(event_key TEXT NOT NULL, subscription_id TEXT NOT NULL, status TEXT NOT NULL CHECK
    (status IN ('sent','failed')), attempts INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY
    (event_key, subscription_id))`. No foreign key; every insert is guarded by the existence of
    its subscription row (D21, R5 "Completion write"), so no delivery row ever refers to a
    deleted subscription;
  - `meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)` with `manual_baseline_at`.
  A file with another `user_version` is refused at startup (exit `2`). Each mutation is one
  transaction.
- **Cleanup**, once at start (after the store opened, before the listener answers) and then every
  `SUBSCRIPTION_CLEANUP_INTERVAL_MS` on its own timer, independent of polls: delete `pending` rows
  whose `confirm_expires_at <= now` (`confirm_expires_at = last_sent_at +
  SUBSCRIPTION_CONFIRM_TTL_MS`); delete `seeded` and `done` events (with their deliveries) whose
  `settled_at` (or `detected_at` for `seeded`) is older than `PULSE_NOTIFY_STATE_RETENTION_DAYS`
  (`notify/src/config.ts:434`, default 30) and whose `manual_id` is not in the `listedIds` of the
  last good manual read (before the first good read no event is pruned). For each `pending` row
  it deletes, cleanup cancels that row's queued confirmation jobs (D19, R5 "Queue
  cancellation") right after the delete committed. An expired `pending` row is treated as absent
  also before cleanup removes it, and its job is never sent (R5 "Job expiry"). So while notify
  runs, an unconfirmed row and its queued job are gone at most `SUBSCRIPTION_CONFIRM_TTL_MS +
  SUBSCRIPTION_CLEANUP_INTERVAL_MS` (25 hours) after its last confirmation mail; a stopped notify
  holds no job (the queue is in memory) and deletes the row at its next start, before it answers
  any request.

### R4 Notify: the listener

- `node:http` server on `PULSE_NOTIFY_SUBSCRIPTIONS_HOST:PORT`, started before the notifier,
  with `headersTimeout` and `requestTimeout` of 10 s. A bind error fails startup like the health
  listener (`notify/src/index.ts:285-293`).
- Order for every request:
  1. unknown path → `404 {"error":"not found"}`;
  2. method not `POST` → `405` with `allow: POST`;
  3. `Authorization` is not `Bearer <token>` equal to the token file (compare SHA-256 digests
     with `timingSafeEqual`) → `401 {"error":"unauthorized"}`; nothing of the body is read;
  4. `content-type` not `application/json` → `415`;
  5. body over `SUBSCRIPTION_MAX_BODY_BYTES` (kit `readBody`) → `413`; not JSON → `400`;
  6. the contract validator fails → `400 {"error":"invalid request"}`;
  7. the operation (R5). A store error → `503 {"error":"unavailable"}` and an error log without
     address or token.
- Every answer has `content-type: application/json`, `cache-control: no-store` and
  `x-pulse-contract: 1` (`WIRE_VERSION_HEADER`, `WIRE_VERSION`).

### R5 Notify: operations

Times come from the injected `now`.

- **Subscribe** `{email}`. Every path below ends with the same answer, `202
  {"status":"accepted"}` with the same headers; only a store error answers `503` (D15, R8). The
  decision is made, and its write and queue entry are committed, before the answer is sent. No
  path waits for SMTP. Each path is one transaction. The operation is a synchronous function
  (`subscribe(email, now): SubscribeOutcome`, not a `Promise`); the listener calls it after the
  body was parsed and writes the answer in the same synchronous step, and worker 1 is woken only
  after that (immediate class, D22). No path sets a timer. The outcome (a label of
  `pulse_notify_subscription_requests_total`, R7) is noted in brackets:
  1. delete the row of `email` if it is `pending` and `confirm_expires_at <= now`, and cancel its
     queued jobs (D19); it is then absent for the steps below;
  2. a `confirmed` row: nothing changes, no mail (`known`). Its consent and its unsubscribe link
     stay as they were;
  3. a `pending` row with `now - last_sent_at < 600000` (10 min, L3) or `confirm_sends >= 3` (L4):
     nothing changes, no mail (`known`);
  4. a `pending` row otherwise: when the global window (L5) is full or the confirmation queue (L6)
     holds 100 jobs, nothing changes, no mail (`limited`). Else new token, new digest,
     `confirm_expires_at = now + SUBSCRIPTION_CONFIRM_TTL_MS`, `confirm_sends + 1`,
     `last_sent_at = now`; after the commit the row's older queued job is cancelled (D19) and the
     new mail is queued (`queued`). So the queue never holds two jobs of one row;
  5. no row: when the store holds `PULSE_NOTIFY_SUBSCRIPTIONS_MAX` rows (L1), or
     `PULSE_NOTIFY_SUBSCRIPTIONS_MAX_PENDING` `pending` rows (L2), or the window (L5) is full, or
     the queue (L6) holds 100 jobs: nothing is stored, no mail (`limited`). Else insert a
     `pending` row (new id, token as in 4, `confirm_sends = 1`) and queue the mail (`queued`).
  The global window is the list of the times of the confirmation mails queued in the last
  3600000 ms (a sliding window over queue times, in memory, at most `CONFIRM_PER_HOUR` entries,
  empty after a restart). A `limited` answer adds 1 to
  `pulse_notify_subscription_limited_total{limit=...}` with the first limit that applied, in the
  order L1, L2, L5, L6 (R7).
- **Confirm** `{token}`: the token must match the confirm pattern, else `400`. Find the row by
  the token's digest. No row, or a `pending` row with `confirm_expires_at <= now` → `404
  {"error":"invalid token"}`. A `pending` row → set `state = 'confirmed'`, `confirmed_at = now`
  → `200`, and after the commit cancel the row's queued confirmation jobs (D19), before the
  answer. A `confirmed` row → `200`, nothing changes.
- **Unsubscribe** `{token}`: the token must match the unsubscribe pattern, else `400`. A wrong
  `mac` → `404`. A right `mac`: delete the row with that id and its delivery rows, if any, cancel
  the row's queued confirmation jobs (D19), then answer `200`. A right `mac` whose row is gone
  (already cancelled, or pruned) → `200`.
- **Confirmation mail** (worker 1, in memory, at most 100 jobs in queue order, one attempt at a
  time, up to 3 attempts per job with the `retryDelay` of `notify/src/delivery.ts:41-43`, each
  attempt with the timeout of D12):
  - A job holds the row id, the digest it was queued for, `expiresAt` (the row's
    `confirm_expires_at`), the address, the raw confirmation token, the unsubscribe token, the
    mailbox key (D20), its attempt count and `notBefore` (the earliest start of its next attempt;
    `0` when queued). Nothing else in notify holds the address of a queued job.
  - **Selection.** Worker 1 goes through the queue in queue order. In one synchronous step it
    drops every stale job it passes (Job expiry, below) and starts the first job that is
    *ready*: `notBefore <= now` and no `inFlight` entry for its mailbox key. That step reads the
    row, adds the `inFlight` entry and calls `sendMail` (D12, D20). A job that is not ready keeps
    its place. So a job that waits for its retry delay, or for a busy mailbox, never holds back a
    ready job of another mailbox.
  - **Wake rule** (future deadlines only). When the selection step finds no ready job, it reads
    `now` once and sorts every queued job that is not in flight into one of two kinds:
    *timed* (`notBefore > now`) and *held* (`notBefore <= now`, not ready only because the
    guard holds its mailbox key). A held job has no deadline: its `notBefore` (`0` when queued,
    or a retry time that has passed) is never used as a wake time. Worker 1 then waits for the
    first of:
    - the injected sleep for `min(notBefore of the timed jobs) - now` ms, only when there is at
      least one timed job. Times are integers, so that value is at least `1`; worker 1 never
      calls the sleep with `0` or a negative value, and it calls no sleep at all when every
      waiting job is held;
    - `guard.waitFor(key, signal)` for each distinct key of a held job (D20);
    - the queue's wake signal (a new job, a cancel);
    - stop.
    Every wait has its own `AbortController`, linked to stop and passed as `signal` to the sleep
    and to each `waitFor`; when one of them ends the wait, worker 1 aborts that controller before
    it runs the next selection step, so no sleep or wait of an earlier round stays pending. A
    wait ends only on one of these four events, so a queue whose waiting jobs are all held runs
    no further selection step until an entry settles, a job arrives, a cancel happens or stop
    begins: no busy loop, and no timer of `0` ms. When the sleep ends while the injected clock
    has not reached the deadline yet, the next selection step finds the job still timed and
    sleeps again for the remaining time, which is again at least `1`. The worker counts its
    selection steps in a read-only `selections` number on the worker object (tests only; not a
    metric).
  - After a temporary error the job stays in its place with attempts + 1 and `notBefore = now +
    retryDelay(attempts, PULSE_NOTIFY_RETRY_DELAY_MS, PULSE_NOTIFY_RETRY_MAX_DELAY_MS)`; after
    the third attempt, or a `PermanentDeliveryError`, it leaves the queue with a `failure`.
  - **Queue cancellation** (D19). `cancel(id)` is synchronous: it removes every job of that row
    id that has no attempt in flight from the queue, so no reference to its address or tokens
    stays in the queue, and wakes worker 1 when it is waiting. It does not wait for, resolve or
    abort an attempt in flight, its own or another job's. An attempt of the cancelled job that is
    already in flight ends by its own result or timeout (D12); that outcome is counted as usual
    (the mail may have been delivered), and the job then makes no further attempt. The callers
    run `cancel(id)` after their transaction committed and before they answer or return:
    unsubscribe, cleanup (per deleted id), confirm (a `pending` row that became `confirmed`),
    subscribe steps 1 and 4. `subscribers delete` runs with the service stopped, when no queue
    exists.
  - **Job expiry.** In the selection step the worker drops a job when `now >= expiresAt`, when
    the row is gone, when the row is `confirmed`, or when the row's digest differs from the
    job's. For the job it starts, this read, the `inFlight` check and entry (D20) and the call
    to `sendMail` are one synchronous step. A deferred job (busy mailbox) is checked again in
    the step that finally starts it, so a job of a deleted generation is never sent and a job
    never borrows the consent or token of another row. A dropped or cancelled job is counted in
    neither mail counter; it leaves the gauge `pulse_notify_subscriber_confirmations_queued` at
    once (an in-flight one when its attempt ended).
  - `From` = the setting, `To` and envelope = the address only, `Subject` =
    `<prefix> Confirm your subscription`, `Message-ID` = `<sha256("confirm:" + id + ":" +
    confirm_sends) first 32 hex>@<from domain>`;
  - body:

    ```
    Someone asked to get incident updates of <STATUS_URL> at this address.

    Confirm: <STATUS_URL>/subscribe/confirm?token=<confirm token>
    The link works for 24 hours. If you did not ask for this, ignore this email.
    If you do not confirm, your address is deleted within 25 hours.

    Unsubscribe: <STATUS_URL>/unsubscribe?token=<unsubscribe token>
    About your data: <STATUS_URL>/#subscribe-notice
    ```
    `<STATUS_URL>` is the origin of R3 (no path, no trailing `/`), so every link is
    `<origin>/<route>` with exactly one `/` between them. "24 hours" and "25 hours" are rendered
    from the contract constants (`SUBSCRIPTION_CONFIRM_TTL_MS`, plus
    `SUBSCRIPTION_CLEANUP_INTERVAL_MS`).
  - When an attempt settles, worker 1 writes nothing to the store (D21): it only updates the
    mail counter and the gauge and, after a temporary error, keeps the job for its retry (which
    Job expiry drops when the row is gone).
  - Jobs are lost at shutdown (the count is logged, no address); the visitor asks again. Stop
    sets a `stopping` flag first, so no selection step starts an attempt after it; it aborts
    the attempt in flight through the `signal` of `sendMail`, and that attempt's settle releases
    its `inFlight` entry.
  - `pulse_notify_subscriber_confirmations_queued` (R7) is the number of jobs queued or in flight.
    A job leaves it only after its final outcome was counted in
    `pulse_notify_subscriber_mails_total{kind="confirmation"}`, or when it was cancelled or
    dropped (counted in neither). So the gauge at `0` and the success counter at a value `n`
    mean that exactly `n` confirmation mails were accepted by SMTP and none is still due.
- **Detection** (in each poll of `Notifier`, after the channels, only when the manual read
  answered and is not a 404):
  - no `manual_baseline_at`: store every key of `seedManualKeys(incidents)` as `seeded` with
    `detected_at = now`, and set `manual_baseline_at = now`, in one transaction. Send nothing.
  - else: `detectManualEvents(incidents, key => store has key)`; store each as `pending` with
    `detected_at = now` and the payload of `buildManualNotification`
    (`notify/src/notifier.ts:150-178`), all in one transaction, then wake worker 2.
  - After that transaction committed (also for the seeding one, and also when it stored no new
    key), the poll adds 1 to `pulse_notify_subscriber_detections_total`. A failed transaction
    adds nothing and logs an error. This counter, not `pulse_notify_polls_total`, is the e2e
    barrier for "notify has read the feed after a write": `pollDone` counts a poll before its
    detection runs (`notify/src/notifier.ts:401`).
  - Polls run one after the other: the next poll is scheduled only after the previous `tick`
    settled (`notify/src/notifier.ts:340-366`). So when the counter reads `d` at some moment, the
    poll that makes it `d + 2` fetched the feed after that moment.
  - The input is the `incidents` of `fetchManualIncidents`, which are already public projections
    (`notify/src/api.ts:301-308`). Nothing from `/admin` is read.
- **Fan-out** (worker 2, one event at a time, ordered by `detected_at` and then `key`, also the
  `pending` events found at start; the e2e scenario does not rely on this order, see deploy
  "Barriers"):
  - A pass reads the ids (only the ids, no address) of the eligible subscriptions in pages of
    100 by `id`: `state = 'confirmed'`, `confirmed_at <= detected_at`, and no delivery row for
    this event. For each id, in one synchronous step, it reads the row (address and state) by
    id; if the row is gone or not `confirmed`, it skips it (D12); else it computes the mailbox
    key (D20) and, when `inFlight` has no entry for it, adds its entry and calls `sendMail`.
    When `inFlight` has an entry for that key (an attempt of worker 1 for the same mailbox), it
    drops the address, waits for that entry to settle (at most 60 s, D12; stop ends the wait),
    and then runs the synchronous step again from the row read. The wait is inside the pass and
    is not a pass of its own. So worker 2 holds at most one address, the one of its current
    send, and none while it waits (only the row id and the key).
  - One message per subscription:
    - `From` = the setting; `To` and envelope = that address only;
    - `Subject` = `<prefix> <State>: <title>`, State is `New incident`, `Update` or `Resolved`;
    - `Message-ID` = `<sha256(event key + ":" + subscription id) first 32 hex>@<from domain>`;
    - body (each value through `cleanText` of `notify/src/channels/message.ts:57-60`):

      ```
      <State>: <title>

      Impact: <impact>
      Status: <status>
      <message>
      Time: <ISO 8601 UTC of the event>

      Status page: <STATUS_URL>
      You get this email because you subscribed at <STATUS_URL>.
      Unsubscribe: <STATUS_URL>/unsubscribe?token=<unsubscribe token>
      ```
    - no reason, check name, component id or other subscriber.
  - Outcome per send: success → delivery `sent` with `attempts` = the event's `passes`;
    `PermanentDeliveryError` or a refused recipient → delivery `failed` with the same
    `attempts`; another error or the D12 timeout → no delivery row, the subscription stays for
    the next pass if it still exists. The mail counter
    `pulse_notify_subscriber_mails_total{kind="incident"}` counts the outcome as usual (success:
    SMTP accepted the message), whether or not a row is written.
  - **Completion write** (D21). The `sent` and `failed` writes of an outcome are each this one
    statement, in its own transaction:

    ```sql
    INSERT INTO deliveries (event_key, subscription_id, status, attempts, at)
    SELECT ?1, ?2, ?3, ?4, ?5
    WHERE EXISTS (SELECT 1 FROM subscriptions WHERE id = ?2)
    ```
    When it inserts no row (the subscription was deleted while the send was in flight), worker 2
    logs nothing about it (no address or id), writes nothing else for that row, and goes on with
    the next id. The finalize step (Pass budget 1) builds its `failed` rows with one `INSERT …
    SELECT` over the current `subscriptions` table in the same transaction that sets the event
    `done`, so it can only write rows of subscriptions that exist at that moment. No other code
    writes `deliveries`. A deleted row is never eligible, so it neither keeps the event `pending`
    nor starts another pass or sleep.
  - **Pass budget.** `N` is `PULSE_NOTIFY_RETRY_ATTEMPTS`, and `12` when that is `0`, so one
    failing address never holds the queue for ever. The budget is stored, not held in memory:
    1. Before a pass sends anything, worker 2 checks `passes`. When `passes >= N`, it does not
       send: in one transaction it writes delivery `failed` with `attempts = passes` for every
       eligible subscription without a delivery row, and sets the event `done` (`settled_at =
       now`). This is the "finalize" step.
    2. Else, when `next_pass_at` is set and `now < next_pass_at`, it sleeps until
       `next_pass_at` (the remaining time, not a new full delay).
    3. Then, in one committed transaction and before the first send, it sets `passes = passes +
       1`. So a pass counts as soon as it starts, also when a stop or crash ends it before any
       send; a restart can never run more than `N` passes for one event.
    4. After the pass: no eligible subscription without a delivery row → the event is `done`.
       Else it sets `next_pass_at = now + retryDelay(passes, PULSE_NOTIFY_RETRY_DELAY_MS,
       PULSE_NOTIFY_RETRY_MAX_DELAY_MS)` (`notify/src/delivery.ts:41-43`) and goes back to step
       1. The `next_pass_at` write and the event's state change are each one transaction.
  - **Recovery after a restart.** Worker 2 starts with the oldest `pending` event and goes
    through steps 1-4 with the stored `passes` and `next_pass_at`. An event whose last allowed
    pass was started before the stop (`passes = N`) is finalized at once and sends nothing. The
    next event then starts. Events after it wait at most for `N` pass starts plus their delays
    in total, whatever the number of restarts.
  - Stop aborts the sleep and any send in flight. The event stays `pending` and the next start
    recovers it as above. An aborted send writes no delivery row.
  - Worker 2 never blocks the channel workers or worker 1.
- **One send per mailbox** (D20). A new module `src/mailbox-guard.ts` holds `inFlight`, a
  `Map<string, { owner: number; settled: Promise<void> }>` from mailbox key to the attempt in
  flight for that mailbox, and the process salt. One guard is created per process and passed to
  both workers. Its interface is synchronous except `settled`:
  - `key(address)`: `HMAC-SHA256(salt, address)` in hex, for an address that the store holds
    (already normalized);
  - `tryAcquire(key)`: returns a new `owner` number (a counter that only grows) and adds the
    entry when the map has none for `key` and the guard is not stopping; else `undefined`;
  - `release(key, owner)`: deletes the entry and resolves its `settled` only when the entry's
    `owner` equals `owner`; any other call does nothing;
  - `waitFor(key, signal)`: the entry's `settled`, or an at once resolved promise when there is
    none; it ends early when `signal` aborts (stop);
  - `size()`: the number of entries, read by tests and by the shutdown log.
  Rules:
  - a worker calls `sendMail` only after `tryAcquire` returned an owner, in the same synchronous
    step as its last row read; the attempt's settle (success, error, the D12 timeout, the stop
    abort) calls `release(key, owner)` in a `finally`;
  - worker 1 defers a job whose key is held and sends another ready job (R5 "Selection"); while
    it has no ready job it waits on `waitFor` for each held key and sleeps only until a future
    `notBefore`, never for `0` or less (R5 "Wake rule");
  - worker 2 waits on `waitFor` and then re-reads the row (R5 "Fan-out");
  - a cancel (D19), a delete, a confirm or a new subscribe of the same address never removes or
    replaces an entry; the entry ends with its attempt, at most 60 s after it started (D12);
  - stop sets the guard to stopping before the workers abort their attempts, so no
    `tryAcquire` succeeds after stop began, and `size()` is `0` once both workers stopped.
  So at most one subscriber email per mailbox is in flight at any moment, across both workers
  and every row (generation) of that address, whatever the order of subscribe, confirm,
  detection, unsubscribe and re-subscribe.
- Subscriber mail never goes through the ledger, the channel deliveries or `failed list|resend`.
- **`subscribers delete <address>`** (D18). `bun src/index.ts subscribers delete <address>` (in the
  image: `bun --no-env-file src/index.ts subscribers delete <address>`, `notify/Dockerfile:20`).
  Wired next to `failed` in `notify/src/index.ts:443-444`. It reads only
  `PULSE_NOTIFY_SUBSCRIPTIONS_STATE` (or its default from `PULSE_NOTIFY_STATE`) and the lock
  settings; it does not need `PULSE_NOTIFY_SUBSCRIPTIONS=on`, so an operator can delete data
  after turning the feature off. It takes the store lock like `runCli` takes the ledger lock
  (`notify/src/index.ts:350-380`), so it runs with the service stopped; a held lock exits `2`
  with the existing lock message. It normalizes the argument with `normalizeSubscriberEmail`; an
  invalid one exits `1` with `pulse-notify: subscribers delete: invalid address`. It deletes the
  row of that address (pending or confirmed) and its delivery rows in one transaction, then
  checkpoints (R3), prints `deleted 1` or `deleted 0` and exits `0`. No output line holds the
  address. A missing store file prints `deleted 0` and creates no store file. Any other argument list
  prints the usage `usage: pulse-notify subscribers delete <address>` and exits `1`.

### R6 Status settings

| Variable | Default | Rule |
| --- | --- | --- |
| `PULSE_STATUS_SUBSCRIPTIONS_URL` | unset (off) | http(s) base URL of the notify listener, for example `http://notify:9300`; never echoed. |
| `PULSE_STATUS_SUBSCRIPTIONS_TOKEN_FILE` | required when the URL is set | the bearer token, read once with `readSecretFile`; at least 32 printable ASCII characters. |
| `PULSE_STATUS_SUBSCRIPTIONS_CONTACT` | required when the URL is set | the operator contact of the notice (R10): an address that `normalizeSubscriberEmail` accepts, or an `https:` URL without credentials of at most 512 characters. Ignored when the URL is unset. |

With the URL set, `PULSE_STATUS_PUBLIC_URL` is required too (the origin check of R2), and it must
be an origin (R9). A missing or bad value fails startup with exit `2` and one line that names the
variable, never its value.

### R7 Logs and metrics

- No log line, error text, metric label or HTTP answer of status or notify holds a subscriber
  address, a token, the key, the bearer token or an SMTP password, with the one exception below.
  The operator contact of R6 is not a subscriber address: it appears in status pages on purpose
  (R10) and never in a log or error line. Logs carry
  counts and fixed reasons. Status logs a failed request with `url.pathname` only, never the
  query (`status/src/server.ts:673-681,873`), so a token in a link's query never reaches a log;
  the new routes keep that.
- **Token exception** (the only one). The `200` answer of `GET`/`HEAD /subscribe/confirm` and
  `GET`/`HEAD /unsubscribe` on status holds the token of that same request's query once, in the
  hidden `token` field of its form, after the token matched its pattern and through
  `escapeHtml`. That answer has `cache-control: no-store` and `referrer-policy: no-referrer`.
  Nothing else holds a token: not the `400` page of a bad link, not a `POST` result page, not
  the `GET /` page, not a notify JSON answer (including `400`, `404` and `503`), not a log line,
  not a metric. Addresses have no exception.
- Notify metrics (registered only when subscriptions are on):
  - `pulse_notify_subscribers{state="pending"|"confirmed"}` (gauge, read at scrape);
  - `pulse_notify_subscriber_events_pending` (gauge, read from the store at scrape: the number of
    events with `status = 'pending'`; an event leaves `pending` only after its last pass ended,
    so `0` means no incident send is in flight or due);
  - `pulse_notify_subscriber_detections_total` (counter, R5 "Detection");
  - `pulse_notify_subscriber_mails_total{kind="confirmation"|"incident",outcome="success"|"failure"}`;
  - `pulse_notify_subscriber_confirmations_queued` (gauge, R5 "Confirmation mail");
  - `pulse_notify_subscription_requests_total{route="subscribe"|"confirm"|"unsubscribe",outcome="queued"|"known"|"limited"|"ok"|"invalid"|"unauthorized"|"error"}`
    (`queued`, `known`, `limited` for subscribe, R5; `ok` for confirm and unsubscribe);
  - `pulse_notify_subscription_limited_total{limit="capacity"|"pending"|"window"|"queue"}`
    (L1, L2, L5, L6).
  These series are on the ops listener, which the operator controls and no setup publishes to the
  internet. They carry no address, and the operator can read the store anyway; they are not a
  public surface of R8.
- Status adds no metric. Its `pulse_status_http_requests_total` counts the new routes by status
  code as today.

### R8 No address enumeration

The public surface is status's HTTP answers to anyone on the internet. Notify's listener is private
(bearer token, no published port); its answers are still made membership-free (D15) so that status
cannot pass on a difference by mistake.

- **Rule.** For two `POST /subscribe` requests that differ only in the address, where both
  addresses pass the address rule, status's answers have the same status code, the same headers
  except `date`, and the same body bytes. This holds whatever the store holds for either address
  (absent, pending, pending in cooldown, pending at its send cap, confirmed, expired pending) and
  under every limit below, at it and below it. The same pairs also have the same timing class
  (D22): the release class at status and the immediate class at notify.
- **Limits** (every finite limit on the subscribe path; each has a counterexample and a test):

| Id | Limit | Where | Effect on the public answer | Timing class |
| --- | --- | --- | --- | --- |
| L0 | 8 notify calls in flight | status | none: the subscribe answer, no call | release |
| L1 | `PULSE_NOTIFY_SUBSCRIPTIONS_MAX` rows | notify | none: `202`, nothing stored | release (notify: immediate) |
| L2 | `PULSE_NOTIFY_SUBSCRIPTIONS_MAX_PENDING` pending rows | notify | none: `202`, nothing stored | release (notify: immediate) |
| L3 | 10 min cooldown per pending row | notify | none: `202`, no mail | release (notify: immediate) |
| L4 | 3 confirmation mails per pending row | notify | none: `202`, no mail | release (notify: immediate) |
| L5 | `PULSE_NOTIFY_SUBSCRIPTIONS_CONFIRM_PER_HOUR` mails per sliding hour | notify | none: `202`, no mail | release (notify: immediate) |
| L6 | 100 queued confirmation jobs | notify | none: `202`, no mail | release (notify: immediate) |
| L7 | 2048-byte form body; 1024-byte notify body | status; notify | `413` before the address is read, the same for every address | at once, before the address |
| L8 | the notify call ends after `SUBSCRIBE_CALL_TIMEOUT_MS` (`1500`) by its own timer, and at the release at the latest (abort) | status | none: the subscribe answer | release |
| L9 | 256 admitted `POST /subscribe` requests (body being read, for at most `SUBSCRIBE_BODY_TIMEOUT_MS` = 5000, or answer waiting for release; a slot is reserved before the body is read and freed when the response closes) | status | `503` busy page before the body is read, the same for every request | at once, before the address |

  The incident fan-out queue (the `events` table, worker 2) and the SMTP sends are not on the
  subscribe path: a subscribe request never reads or waits for them, so their state cannot
  change the answer or its time. The notify store error (`503`) is global, not per address, and
  status maps it to the subscribe answer at the release like every other notify outcome.
- **Precedence.** Status: origin (`403`) → L9 check and slot reservation in one synchronous step
  (`503`) → content type (`415`) → L7 (`413`) → form fields (`400`) → address rule (`400`) →
  release timer registered → L0 (no call) → notify call (its timeout timer registered), cut by
  L8 → release writes the answer → the response closes and frees the L9 slot. Notify: path (`404`) → method (`405`) → bearer (`401`) → content type (`415`) → L7
  (`413`) → JSON and validator (`400`) → R5 subscribe steps 1-5, where the first limit that
  applies is counted in the order L1, L2, L5, L6 for an absent address and L5, L6 for a pending
  one past L3 and L4. Each step before "release timer registered" reads only the request's
  bytes and global counters, never the store and never the address's membership.
- **Before the address.** The origin check (`403`), the admission cap L9 (`503`), content type
  (`415`), size (`413`), form fields (`400`) and the address rule (`400` with the form) run
  before any notify call and read nothing of the store. Their answers, and when they are sent,
  depend only on the request's own bytes and on the global number of admitted requests.
- **Confirm and unsubscribe stay usable at every subscribe limit.** L0, L9 and L1-L6 apply to
  `POST /subscribe` only. A `POST /unsubscribe` or `POST /subscribe/confirm` is neither counted
  nor refused by them, so a visitor can always leave, also during a subscribe flood.
- **No other public surface.** No route lists, counts or looks up subscriptions. Confirm and
  unsubscribe need an unguessable token (D8) and answer by the token, not the address. A
  `confirmed` address that subscribes again gets no mail, and its consent is kept, so a repeat
  neither leaks nor revokes.
- **Timing** (D22). Two classes, both defined on injected schedulers so that tests are exact:
  - *Release class* (status, every request that passed the address rule): the request's timer
    registrations, cancelled ones included, are exactly `[5000, 2000, 1500]`, or `[5000, 2000]`
    when L0 skips the call (R2 "Release"). `5000` is the body deadline, registered before the
    body was read and cancelled when it ended, before the address rule ran. Exactly one release
    timer is registered, with the delay `SUBSCRIBE_RELEASE_MS` = `2000`, as the first timer after
    the address passed, in the synchronous step in which the address passed and before the
    notify call starts; the notify call then registers exactly one more timer, its timeout of
    `SUBSCRIBE_CALL_TIMEOUT_MS` = `1500`, and a request skipped by L0 registers none after the
    release timer. At most two timers of a request are live at once (release and call timeout);
    no byte of
    the answer is written before the release timer fires, also when the call's timer fired; the
    whole answer is written when the release fires; the notify call is aborted then if it is
    still open. The notify outcome (fast `202`, error, `3xx`, bad body, no answer, call timeout,
    no call) changes neither the delay nor the moment of writing.
  - *Immediate class* (notify, every valid subscribe request): the answer is written in the
    synchronous step that runs `subscribe()`, after the body was parsed; no timer is registered
    and the injected clock is not read again between the decision and the write; no `sendMail`,
    fan-out or queue wait is awaited. A request that the listener refuses before the operation
    (`401`, `413`, `415`, `400`) is also answered without a timer.
  SMTP and the fan-out are excluded from both classes: they run after the answer, and the tests
  hold them unresolved throughout. The spec does not claim equal wall-clock time on the network;
  the e2e scenario checks a lower bound only (deploy steps 5a and 5b).

### R9 Root hosting

- With subscriptions on, status refuses a `PULSE_STATUS_PUBLIC_URL` whose path, after removing a
  trailing `/`, is not empty: exit `2` with the line `PULSE_STATUS_PUBLIC_URL: must be an origin
  without a path when subscriptions are on (root hosting)`. `https://status.example.com` and
  `https://status.example.com/` are accepted. With subscriptions off, a path is accepted as today
  (`status/src/settings.test.ts:98` stays).
- With `PULSE_NOTIFY_SUBSCRIPTIONS=on`, notify refuses a `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL`
  with a path the same way: exit `2` with the line `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL: must be
  an origin without a path (root hosting)`.
- Both checks run before any listener, store or lock is opened, so no partial consent flow starts.
- All forms post to root paths (`/subscribe`, `/subscribe/confirm`, `/unsubscribe`), result pages
  link to `/`, and mail links are `<origin>/subscribe/confirm?token=…`,
  `<origin>/unsubscribe?token=…` and `<origin>/#subscribe-notice`. No link or form action is built
  from `Host`, `X-Forwarded-*`, `Referer` or a visitor value.
- The status and notify READMEs and `docs/configuration.md` say: "Email subscriptions need the
  status page at the root of its origin, for example `https://status.example.com`. A path such as
  `/pulse` is refused at startup while subscriptions are on." `deploy/full/README.md` says the
  same.

### R10 Visitor notice, contact and retention

- **Inventory** (what notify stores; the notice must say the same, and the notify docs list it):
  in the store, per subscription: the address, the state (pending or confirmed), `created_at`,
  `last_sent_at`, `confirm_sends`, `confirmed_at`, the SHA-256 digest of the current confirmation
  token and its expiry; per incident email: a delivery row with the subscription id (not the
  address), sent or failed, attempts and time. In memory only: the address and tokens in a queued
  confirmation job (at most 100 jobs; removed with its row, when its link is replaced or
  expires, when its row is confirmed, and at restart, R5 "Confirmation mail"), the address of
  at most one send attempt in flight per mailbox, across both workers and every subscription of
  that address (at most 60 s, D12, D20), the keyed digest of that mailbox in the send guard for
  as long as that attempt runs (the key of the digest is random per process and never stored),
  and the queue times of the global window (no address). Status holds no address after it built
  the notify call; its admitted requests (at most 256, each for at most 5 s of body reading plus
  2 s of waiting) hold no address after the address rule ran.
  Nothing in logs or metrics. Events hold public incident content only.
- **Retention**: pending rows and their queued jobs as R3 "Cleanup" (gone within 25 hours of the
  last confirmation mail while notify runs); confirmed rows until unsubscribe or `subscribers
  delete`; queued jobs of a deleted row at the delete (D19); delivery rows with their
  subscription or with their event after `PULSE_NOTIFY_STATE_RETENTION_DAYS`, whichever is
  first. **In-flight boundary**: at most one subscriber send attempt per mailbox is in flight at
  any moment, confirmation and incident mail together, and across every subscription of that
  address (D20). That one attempt, when it already started before the delete was answered, is
  not aborted; it ends within 60 s and its email can still arrive, but its outcome writes no row:
  no delivery row of a deleted subscription is ever written, also when that attempt settles after
  the delete (D21 "Completion write"). No second email of the deleted subscription can start
  after the delete (D12 re-read, D19 cancel), and a new subscribe of the same address cannot
  start its confirmation mail until that attempt settled (D20). The notice says so ("One email
  that is being sent at that moment can still arrive."). A confirmation mail that the visitor
  asks for again after the delete is a new request, not a mail of the deleted subscription.
- **Notice** (status renders it under the input, R2; `<contact>` is the R6 contact as a link:
  `<a href="mailto:<address>">address</a>` for an address in its normalized form, `<a
  href="<url>">url</a>` for an `https` URL, both through `escapeHtml`; "24 hours", "25 hours"
  from the contract constants):

  ```html
  <div id="subscribe-notice">
  <h3>About your data</h3>
  <p>We store your email address, whether and when you confirmed it, when you subscribed, how many confirmation emails we sent, a fingerprint of your current confirmation link, and a record of each incident email to you (sent or failed, and when). We use them only to send you incident updates of this status page. We do not log your address.</p>
  <p>If you do not confirm, we delete all of it within 25 hours of the last confirmation email. The confirmation link works for 24 hours. After you confirm, we keep it until you unsubscribe.</p>
  <p>Every email has an unsubscribe link. It deletes your address and these records at once, also from emails that are waiting to be sent. One email that is being sent at that moment can still arrive. Deleting does not remove emails already sent, or copies in the operator's backups.</p>
  <p>To ask about your data, or to have it deleted without a link, contact <contact>.</p>
  </div>
  ```
  The `<h3>` follows the section's `<h2>`, so the heading order stays valid for the axe check.
- **Operator duties** (status and notify `docs/operation.md`, `deploy/full/README.md`): answer
  the contact; delete on request with `subscribers delete` (D18); keep backups of the notify
  volume for a stated time and delete them after it; the store is personal data and lives on the
  notify data volume only.

### R-limits and known limits (documented in the notify and status READMEs)

- D-R1 At least once (D11).
- D-R2 An event whose incident left the bounded manual feed while notify was down is never seen
  and never mailed.
- D-R3 Order: subscriber events are sent one by one; an SMTP outage delays later events.
- D-R4 Rate limits are per process and start empty after a restart.
- D-R5 A confirmation mail that was queued but not sent when notify stopped is lost; the visitor
  can ask again after 10 minutes.
- D-R6 Clock: eligibility uses notify's clock only (D5).
- D-R7 Backups: the store file holds addresses. It belongs to the notify data backup and must be
  protected like it. Losing it drops all subscriptions; restoring an old copy brings back rows
  that later unsubscribed (their old unsubscribe links still work).
- D-R8 Key rotation: a new HMAC key breaks the unsubscribe links of every delivered mail. Keep the
  key. A visitor with a broken link asks the contact (D18). Turning subscriptions off keeps the
  store; turning them on again resumes with the same rows and baseline.
- D-R9 No per-requester limit (D16); a flood can fill L5 and delay real confirmation mails for
  up to an hour.
- D-R10 Root hosting only (R9).
- D-R11 Copies outside the live store (backups, mailboxes, SMTP provider logs, unsent WAL frames
  before a checkpoint) are not removed by a delete; the notice says so for backups and sent
  mail.
- D-R12 Every valid subscribe answer arrives 2 s after the submit (D22), and while 256 subscribe
  requests are admitted (body being read for at most 5 s, or answer waiting), every further
  subscribe request gets the busy page (L9).
- D-R13 The one-send-per-mailbox bound (D20) holds inside one notify process and its store; it
  does not cover the operator email channel or a second notify with another store.

## Risks

- **Privacy leak through mail.** Mitigation: the only input is the public projection already
  used by the channels (#568); the body has a fixed set of fields; the e2e scenario uses private
  markers and checks every mail in mailpit for them.
- **A link scanner confirms or unsubscribes.** Mitigation: D9, `GET` changes nothing.
- **Abuse of the subscribe form to send mail.** Mitigation: double opt-in, per-row cooldown and
  send cap, the global window, the queue cap, the row and pending caps, status's in-flight cap,
  the 1 KiB/2 KiB body limits. Known limit: a flood fills the global window and real visitors get
  no confirmation mail for up to an hour; their answer is the same `200` page (D16).
- **Address enumeration.** A difference in status code, header, body or a limit that only
  unknown addresses hit tells an attacker who is subscribed. Mitigation: D15 and R8; status never
  derives the subscribe page from notify's answer; tests compare known and unknown addresses
  byte for byte at every limit, in both orders, and the e2e scenario does it over real HTTP below
  and at capacity.
- **Enumeration by timing.** A known address answered earlier (no write) or later (a wait) than
  an unknown one leaks membership even with equal bytes. Mitigation: D22. Status writes every
  valid subscribe answer from one release timer of fixed delay, whatever notify does; notify
  answers without a timer or an awaited send. Tests use injected schedulers and a fake notify
  that answers known and unknown addresses at different moments on purpose; status must still
  release both at the same scheduler step. Residual: network and CPU jitter around the release
  are not equalized, and a flood that fills L9 delays everyone alike.
- **Held answers as a resource.** Each valid subscribe holds a socket and a timer for 2 s, and a
  slow body holds a socket while it is read. Mitigation: L9 (256 admitted requests, the slot
  reserved before the body is read and freed when the response closes, `503` beyond), its body
  deadline of 5 s on the injected scheduler, and L0 (8 notify calls). Status sets no
  `headersTimeout` or `requestTimeout` of its own, and the runtime defaults (300 s request
  timeout) do not bound a slow body in seconds, so the spec does not rely on them. Known limit: a
  client that keeps 256 slow requests open refuses subscribe for everyone (the same busy page),
  but never confirm or unsubscribe.
- **A notice that is not true.** Mitigation: R10's inventory names the columns of R3; the times
  come from the contract constants that notify's cleanup uses; notify tests check cleanup at the
  literal boundaries 25 hours minus 1 ms and 25 hours. The in-memory confirmation queue follows
  the same deletes (D19), and notify tests delete jobs behind a send that the fake keeps
  blocked; the one attempt in flight is bounded (D12), the two workers never have two attempts
  in flight for one mailbox, also across an unsubscribe and a new subscribe of the same address
  (D20, tested with held attempts of both workers, re-subscribe under another spelling, and the
  maximum in flight per address recorded by the fake mailer), and the notice names that one
  email. That email's late outcome
  writes no delivery row (D21, tested with an incident send held across the unsubscribe and then
  settled four ways).
- **Prefix hosting misconfigured.** Mitigation: R9 refuses a path at startup in both services,
  before any file is opened; the e2e scenario checks both refusals.
- **Two notify processes on one store.** Mitigation: the lease lock of the store.
- **Merge conflicts with #570** in `notify/src/index.ts`, `notify/src/config.ts`,
  `notify/src/notifier.ts`, `status/src/settings.ts`, `status/src/server.ts`,
  `deploy/e2e/compose-e2e.sh` and `deploy/.github/workflows/ci.yml`. Mitigation: the new code
  sits in new modules, the wiring change is small, and a conflict runs the `merge` workflow.
- **Fan-out time.** One SMTP connection per message (today's `sendMail`). At 50-200 ms per message,
  10 000 subscribers take 8-33 minutes per event. Documented; pooling is a later change.

## Performance impact

The api does not change, so no `api` metric of `bench/budgets.json` can move. The bench stack runs
notify and status without the new variables (`api/bench/compose.bench.yaml:47-75`, fixture
`api/bench/fixtures/notify.json`), so subscriptions are off there.

| Service | Metric (`api/bench/budgets.json`) | Expected change | Why |
| --- | --- | --- | --- |
| status | `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms` | none (within noise) | off: one setting read, the page template gets an empty placeholder |
| status | `test_cpu_s` (gating, budget 3.4 s, `api/bench/budgets.json:179-183`) | + up to 0.5 s | new HTTP suites with a fake notify, including the enumeration and timing comparisons; every suite drives the release timer through an injected scheduler, so no test sleeps 2 s of real time |
| status | `image_mb` | none | no new dependency |
| notify | `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms` | none (within noise) | off: one setting read, no listener, store or worker |
| notify | `test_cpu_s` (gating, budget 3.4 s, floor 1.5 s, `api/bench/budgets.json:216-221`) | + up to 0.9 s | new suites with SQLite and HTTP, the enumeration and timing cases with fresh stores, the mailbox guard cases, and the CLI |
| notify | `image_mb` | none | no new dependency |
| contract | `test_cpu_s` (gating, 9.0 s, floor 2 s), `build_cpu_s` | + up to 0.2 s each | one small module |
| api, probe | all | none | not changed |

With subscriptions on, notify holds one page of 100 rows and one message at a time, so its RSS grows
by the SQLite page cache and not by the number of subscribers. The mailbox guard holds at most two
entries (one per worker). Status, with subscriptions on, holds at most 256 admitted subscribe
requests (one socket and at most two live timers each) and 8 notify calls; a visitor's subscribe answer arrives 2 s after the
submit by design (D22). The deploy e2e scenario sends about 15 valid subscribe requests one after
the other, so it runs about 30 s longer; that is not a bench metric.

How each child measures:

- `test_cpu_s`: five runs of `bun run test` on the branch and on the `main` it started from, CPU
  time as `user + sys` of `/usr/bin/time -f '%U %S'`, median of the five per side. The PR shows
  both medians and B − A. It fails when B is above the budget of that repository in
  `api/bench/budgets.json`.
- Runtime metrics: when api `main` has `--b-ref` (from #570's api part), run
  `bun bench/run.ts --a <api main SHA> --b <api main SHA> --others-ref main --b-ref
  <status|notify>=<branch SHA>` in an api checkout (`--rounds 1` allowed locally; say so) and
  paste the table. Without `--b-ref` on api `main`, the PR states that and why none is expected
  (feature off in the bench fixture).
- notify only, feature on (reported, not gating): with a scratch script outside the repository
  (nothing is committed), fan out one event to 2 000 confirmed rows in a `mkdtemp` store with a
  fake `sendMail` that resolves at once. Report the CPU time (`process.cpuUsage()`), and the RSS
  (`process.memoryUsage().rss`) before and after, in the PR. Expected: under 5 s CPU and under
  20 MiB RSS growth. A higher value is reported and explained, not hidden.

## Security impact

Security impact: yes
New anonymous public write routes, a new authenticated service listener, mail sent to visitor
input, new secrets, file writes, and CI changes.

Checklist items that apply:

- **Secrets in errors, logs and responses**: R7; startup errors name the variable only; the
  status pages never echo the address; a token appears in exactly one kind of answer, the `200`
  `GET`/`HEAD` page of the confirm and unsubscribe links, in its hidden form field (R7 "Token
  exception"), which is `no-store` and `no-referrer`; every other status page and every notify
  answer holds no token (status checks and notify security test); the e2e scenario scans logs
  for addresses, tokens and secrets. The SMTP password: notify reads it with `readSecretFile`
  and its errors name the variable and path only; secrets-init's rule lines name the file and
  the rule only, checked with the password literal (deploy checks); the password is never in the
  override, `.env` or an environment value: the environment holds only its file path
  `/run/pulse/subscriptions-smtp-password`, and the deploy `config` check looks for the
  password literal and secret formats, not for the word `password` (deploy "secret check").
- **Personal data in memory**: a delete removes the row's queued confirmation jobs at once (D19),
  checked behind a send that the test keeps blocked; fan-out holds one address at a time; at most
  one attempt per mailbox is in flight across both workers and every subscription of the address
  (D20) and it ends within 60 s (D12); the guard holds a keyed digest, never the address, and its
  key is random per process; when the attempt settles after a delete, its guarded completion
  write inserts nothing (D21), so the delete stays complete in the store. Status's waiting
  answers hold no address (R2 "Release").
- **Auth order and status codes**: notify R4 (path, method, then auth before any body read);
  status R2 (origin and L9 before body); exact codes in R1 and R2; one public subscribe answer
  for every valid address under every limit L0-L9 (R8), checked byte for byte with known and
  unknown addresses, and one timing class (D22), checked with injected schedulers.
- **Body and size limits**: status 2048 bytes; notify `SUBSCRIPTION_MAX_BODY_BYTES` 1024; status
  reads at most 4096 bytes of a notify answer; row cap, pending cap, queue cap, window cap,
  status in-flight cap, status admission cap (L9: slot reserved synchronously before the body is
  read, freed once when the response closes, body deadline 5 s), and the notify call's own
  1500 ms timeout and its cut at the release (L8).
- **Input validation**: the address rule (R1) at status and again at notify; token patterns;
  strict objects; exact form fields; no header injection (CR/LF rejected, one recipient per
  message, `To` built from the stored normalized address only); the contact setting (R6) is an
  address or an `https` URL, escaped in text and attribute; the root rule of R9 for both public
  URL settings.
- **Accessor execution**: notify parses JSON with `readJsonBody` and the contract zod validators;
  the error text of `requestJson` reads an own data property only
  (`contract/src/client.ts:246-260`).
- **SSRF and redirects**: status calls only the operator-set notify URL, never a URL from a
  request, and treats `3xx` as an error; links in mail use only the configured base (D10).
- **Atomic, path-safe writes**: the store is a SQLite file at a configured path, created `0600`
  with its lock; deletes run with `secure_delete` and a WAL checkpoint (R3); `subscribers
  delete` takes the store lock; secrets-init writes the new secrets and the optional SMTP
  password through its temp-and-rename path, `0400` `1000:1000`, refuses a symlinked or
  group-readable host file (`readHostFile`), and removes a stale password copy only inside its
  own `/out/notify` volume.
- **Dependency pins**: status and notify bump the contract pin to the merged full SHA. No new
  package. Mailpit stays on its pinned digest in `common/services.yaml`.
- **CI**: deploy adds a CI requirement and test steps; no new action, no secret in CI.
- **Dockerfiles**: notify's image gets one `ENV` value, `PULSE_NOTIFY_SUBSCRIPTIONS_HOST=0.0.0.0`.
  The listener still starts only with `PULSE_NOTIFY_SUBSCRIPTIONS=on`, and it needs the bearer
  token. No port is published in any setup.
- Not applicable: admin routes and authentication of the api, and the probe HTTP client.

## Rollout order

1. **contract** (new minor, D13: `2.5.0` on today's `main` `2.4.0`, also after #815's patch
   `2.4.1`). Additive. Every consumer on an older pin keeps working: no existing export, schema or
   `WIRE_VERSION` changes. Status and notify pin `9ab7e249…` (`2.1.0`) today; the new pin also
   brings the `2.2.0`-`2.4.x` additions, which are additive too.
2. **status** and **notify**, in either order, each with the new contract pin.
   - Both default to off. An upgrade without the new variables changes nothing.
   - New status with old notify (operator set the URL too early): the subscribe call fails, the
     visitor gets the same subscribe answer at the same release time as always (D15, D22),
     status logs the failure kind, and
     nothing is stored. Confirm and unsubscribe answer `503` (no token exists anyway).
   - Old status with new notify: notify's listener is unused; incident fan-out works for rows that
     exist (none without status).
   - Probe, api, console and kit are untouched and keep their pins.
   - A downgrade of notify leaves the store file on the volume. The old notify ignores the
     variables and the file. A later upgrade resumes with the same rows and baseline (events
     during the downgrade that are still in the manual feed are detected then, with that
     `detected_at`).
   - #570: if #570's notify part merged first, its ledger format 5 and reports are untouched by
     this change; subscriber state is never in a report.
3. **deploy**, after both service PRs merged (its `e2e-dev` CI builds `main` of each service).
   `full` runs the published `0.1.0` images, which lack the feature, so the scenario prints
   `skip: email subscriptions (published images)` there. The `e2e-dev` job requires the `ok:`
   line, so a skip cannot pass there. Turning the scenario on for `full` is part of the image
   bump that follows a release (an owner decision).
4. **meta** (this spec PR) extends the approved use of mailpit before the deploy child starts.

## Counterexamples

### Address rule (`normalizeSubscriberEmail`)

| Input | Result | Rule |
| --- | --- | --- |
| `" Sub-A@E2E.Invalid\t"` | `"sub-a@e2e.invalid"` | trim spaces/tabs, lower case |
| `"a@example.com\r\nBcc: x@example.org"` | `undefined` | CR/LF |
| `"a@example.com, b@example.com"` | `undefined` | space inside and two `@` |
| `"a@b"` | `undefined` | one label |
| `"a..b@example.com"`, `".a@example.com"`, `"a.@example.com"` | `undefined` | dots |
| `"\"a b\"@example.com"` | `undefined` | quote and space |
| `"ü@example.com"` | `undefined` | non-ASCII |
| `"a@-example.com"`, `"a@example-.com"` | `undefined` | hyphen at label edge |
| `"a@192.168.0.1"`, `"a@[192.168.0.1]"` | `undefined` | all-digit last label; literal |
| local part of 65 characters | `undefined` | local 1..64 |
| 64 + `@` + 189 = 254 characters, valid labels | accepted | limit is inclusive |
| the same with 255 characters | `undefined` | over 254 |
| `"Name <a@example.com>"` | `undefined` | display name |
| `{ "email": "A@example.com" }` on the wire | `400` at notify | not normalized |

### Status routes

- `POST /subscribe` with `Origin: https://evil.example` → `403`, notify gets no call (the fake
  counts 0).
- `POST /subscribe` with `Origin: null` → `403`.
- `POST /subscribe` without `Origin`, with `Sec-Fetch-Site: cross-site` → `403`.
- `POST /subscribe` without both headers → goes on.
- `content-type: application/json` → `415`; `multipart/form-data` → `415`.
- Body of 2049 bytes → `413`.
- `email=a@example.com&email=b@example.com` → `400`; `email=a@example.com&x=1` → `400`.
- `GET /subscribe/confirm?token=<valid>` changes nothing: the fake notify gets 0 calls.
- `HEAD /unsubscribe?token=<valid>` → `200`, 0 notify calls.
- `GET /subscribe/confirm?token=<43 chars>&token=<43 chars>` → `400`.
- Token exception (R7), with the literal token `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`
  (43 `A`): the `200` answer of `GET /subscribe/confirm?token=<it>` holds it exactly once, inside
  `name="token" value="…"`; the `400` answer of `GET /subscribe/confirm?token=<it>B` (44
  characters) holds neither the 43- nor the 44-character string; the `POST /subscribe/confirm`
  result pages for notify `200`, `404` and `503` do not hold it. A wrong implementation that
  echoes the bad token on the error page, or the token on the result page, fails here.
- Notify answers `302` to `POST /subscribe/confirm` → `503`; to `POST /subscribe` → the subscribe
  answer. In both, the `Location` is not followed (the fake's second server gets 0 requests).
- Notify answers `200` to confirm without `x-pulse-contract` → the confirmed page (absent
  tolerated, as `requestJson` does); with `x-pulse-contract: 2` → `503`.
- `POST /subscribe` with `email=not-an-address` → `400` with the form; the same body with a
  hostile address `"<script>"@x` → `400`, the text `<script>` is not in the answer.
- `PUT /subscribe` → `405`, `allow: GET, HEAD`.
- L9: with 256 subscribe answers waiting (manual scheduler, release timers not fired), a 257th
  `POST /subscribe` with a valid body → `503` with the busy page at once, and the fake notify
  gets no call for it; a wrong implementation that reads the body or checks the address first is
  caught by sending that 257th request with the body `email=not-an-address` → still `503`, not
  `400`. Fire one release timer and wait for that response's `close` → the next
  `POST /subscribe` is admitted again (its release timer is registered).
- With L9 and L0 both full: `POST /unsubscribe` with a valid token → the fake notify gets the call
  and status answers `200 You are unsubscribed. You get no more emails.` at once (no release
  timer); `POST /subscribe/confirm` the same with `200`.
- Client closes the socket before the release → the release timer is cancelled (the manual
  scheduler shows it cancelled), the notify call's signal is aborted, and its slot is free again
  (the probe of "Admission (L9), partial bodies" below admits exactly one more request).
- Feature off: `POST /subscribe` → `405`; `GET /subscribe/confirm?token=…` → `404`; the page has no
  `id="subscribe"`; the CSP has `form-action 'none'`.

### Admission (L9), partial bodies

Setup in `src/subscribe-routes.test.ts`: a real status server on `127.0.0.1:0` with the manual
scheduler (nothing fires unless the test fires it) and a fake notify on port 0 that holds every
`POST /subscriptions` call unanswered until the test ends it (so L0's 8 calls stay in flight and
the number of calls does not depend on network timing) and answers confirm and unsubscribe calls
`200` at once.
The test adds its own `"request"` listener to the returned `Server` after `createStatusServer`
returned. Node's `EventEmitter` calls listeners in the order they were added, so the test's
listener runs right after status's handler has run its synchronous part for the same request
(checked on Bun 1.4.0 in this spec run: the second listener saw `res.writableEnded === true` for a
request the first had answered `503` synchronously, and `false` for one whose body was still
open). In that listener the test records, per request, `admitted = !res.writableEnded` and, for a
refused one, `res.statusCode`; it also adds `res.once("close", …)` to learn when a response
closed (after status's own `close` listener, which frees the slot). Every request is a raw
`node:net` socket that sends complete headers with `content-type:
application/x-www-form-urlencoded` and `content-length: 30` and then only the 6 bytes `email=` of
its body, and keeps the socket open. The "probe" used below sends two more such requests, one
after the other, and expects the first `admitted` and the second refused with `503`, which shows
that exactly one slot was free.

- **The review's race.** 257 partial-body requests are written to 257 sockets in one loop,
  without waiting between them. Expected, as literals in the test: exactly `256` requests
  recorded `admitted`, exactly `1` recorded `503`, the `503` socket receives the busy page while
  every other socket has received `0` bytes, the fake notify has `0` calls, and the scheduler has
  exactly `256` timers, each of `5000` ms (body deadlines) and `0` of `2000` ms. Then the test
  completes the 256 bodies (24 more bytes each, a valid address each): the scheduler now has
  `256` release timers of `2000` ms and `8` call timers of `1500` ms (L0 lets 8 calls start; the
  fake notify has `8` calls), and all `256` body timers are cancelled; a 258th request → `503`. A wrong implementation that counts only answers waiting for release (the check before
  the body, the increment after it) records `257` admitted and `257` release timers, and fails.
- **Freed exactly once, by each path.** Each path runs on a fresh server with 255 admitted
  partial-body requests plus one request R of that path (256 admitted, checked by one request
  that gets `503`). R frees its slot by the path; the test waits for R's response `close`, then
  runs the probe (one admitted, the next `503`):
  1. R is sent with `content-length: 20`, its first 6 bytes `email=` at once and then the rest
     of `email=not-an-address` → `400` with the form;
  2. R is sent with `content-length: 2049` and 2049 body bytes → `413`;
  3. R's body has two `email` fields → `400`;
  4. the client destroys R's socket during the body (no byte was written to it);
  5. the client destroys R's socket after a complete valid body, before the release (its release
     timer is then cancelled);
  6. R's body deadline fires (the test fires that `5000` ms timer) → the server closes R's socket
     with `0` bytes received;
  7. R's release fires after a complete valid body → the subscribe answer;
  8. R is sent with `content-type: text/plain` → with 255 others admitted it gets `415` at once
     and registers no timer (the `415` check comes after admission, so R did take a slot, and
     the slot is free again after its close); with 256 others admitted the same R gets `503`
     (L9 comes first).
  A wrong implementation that frees on both `finish` and `close`, or on both the release and
  `close`, frees two slots for one request; the probe then admits two and fails. One that frees
  only at the release keeps the slot after paths 1-6, and the probe's first request gets `503`.
- **Count back to zero.** After all 256 sockets of a case were closed and every response's
  `close` was seen, 256 new partial-body requests are admitted and the 257th gets `503` (literals
  `256` and `1`).
- **Not counted.** With 256 admitted, `POST /unsubscribe` and `POST /subscribe/confirm` with a
  valid token → the fake notify gets the call and status answers `200` (as above), and a further
  `POST /subscribe` afterwards still gets `503` at once (the count did not change).

### Notify listener

- No `Authorization`, valid body → `401`, the store is unchanged.
- `Authorization: Bearer <token>x` (one character more) → `401`.
- Wrong token and a 2 MiB body → `401` (the body is not read).
- `GET /subscriptions` → `405`, `allow: POST`; `POST /subscriptions/other` → `404`.
- `{"email":"a@example.com","extra":1}` → `400` (strict).
- `{"token":"<44 characters>"}` on confirm → `400`.
- No notify answer body holds the request's token or address: confirm with an unknown valid
  token → `404 {"error":"invalid token"}` exactly; subscribe with a valid address → `202
  {"status":"accepted"}` exactly, also at L1, L2, L5 and L6.
- Store error (the test closes the store under the listener) → `503 {"error":"unavailable"}` for
  every subscribe request, known or unknown.
- `subscribe()` returns a plain object, not a `Promise`, for every outcome (`queued`, `known`,
  `limited`); a wrong implementation that `await`s the queue or the mailer has an `async`
  signature and fails the check `!(result instanceof Promise)`.

### `subscribers delete`

- Service running (lock held) → exit `2`, the store is unchanged.
- `subscribers delete Sub-A@Example.com` with a confirmed `sub-a@example.com` → `deleted 1`, exit
  `0`; again → `deleted 0`, exit `0`; the output never holds `sub-a`.
- `subscribers delete "a@b"` → exit `1`, `pulse-notify: subscribers delete: invalid address`.
- `subscribers delete` (no argument) and `subscribers delete a@example.com b@example.com` → exit
  `1`, the usage line.
- After the delete, a second connection finds no row and no delivery row of that id, and the
  `-wal` file has size `0`.

### Lifecycle and timing (injected clock `t`, in ms)

- Subscribe at `t=0` → mail 1. Subscribe at `t=599999` → `202`, no mail. At `t=600000` → mail 2
  (token rotates; mail 1's confirm link now answers `404`). At `t=1200000` → mail 3. At
  `t=1800000` → `202`, no mail (`confirm_sends = 3`).
- Confirm with mail 3's token at `t = last_sent_at + 86399999` → `200`; at `last_sent_at +
  86400000` → `404` (the end is exclusive).
- Confirm twice → `200` and `200`; `confirmed_at` is the first time.
- Confirm, unsubscribe, then confirm with the same token → `404`; the address gets no later mail.
- Unsubscribe twice → `200` and `200`.
- Unsubscribe with a valid `id` and a `mac` of another key → `404`; the row stays.
- Unsubscribe B from B's confirmation mail while `pending`; then B's confirm token → `404`.
- Subscribe A, unsubscribe, subscribe A again: a new `id`; the old unsubscribe token answers
  `200` but does not touch the new row (the new row is still there afterwards); the new row needs
  confirmation.
- Global window with `CONFIRM_PER_HOUR = 2`: mails queued at `t=0` and `t=1000`; a new address at
  `t=3599999` → `202`, no row, no mail, `limited_total{limit="window"}` `+1`; at `t=3600000` →
  `202`, a row and a mail (the entry of `t=0` left the window, `now - queuedAt >= 3600000`).
- Row cap 2 with 2 rows; a new address → `202`, no row, no mail; an existing `confirmed` address →
  `202`, nothing changes. The wrong implementation of PR #814 (`429` for the new address) fails.
- Cleanup boundaries (contract constants, literal ms; the cleanup timer runs at `t=0`, `3600000`,
  …): last confirmation mail at `t=1`, so `confirm_expires_at = 86400001`. Confirm at
  `t=86400000` → `200`; at `t=86400001` → `404`. The run at `t=86400000` keeps the row; the run at
  `t=90000000` deletes it, and a second connection to the store file finds no row with that
  address afterwards. A wrong implementation that runs cleanup only on polls keeps the row when
  the fake api fails every poll; the test makes every poll fail. A
  confirmed row is never deleted by cleanup (still there at `t=10 * 86400000`).

### Confirmation queue (D19), behind a blocked send

Fixture for each case (injected clock `t` in ms, fake cleanup timer, test key and token
files): A subscribes at `t=0`, B at `t=1`, C at `t=2`. A fake `sendMail` returns, for its first
call (A's attempt 1), a promise that the test holds unresolved. So the queue holds A (in flight),
B and C, and the gauge `pulse_notify_subscriber_confirmations_queued` reads `3`. Each check below
runs while A's promise is still unresolved (except where a case says otherwise), and asserts that
the fake was called exactly once (for A) at that point: the deletion neither waited for nor
advanced A's send. The test builds B's unsubscribe token itself, from B's row id (read through a
second connection to the store file) and the test key, with its own `node:crypto` HMAC. Every
expected value is a literal in the test.

- Unsubscribe behind the blocked send: unsubscribe B at `t=10` → `200` while A is unresolved; the
  gauge reads `2` right after the answer. Then resolve A: over the rest of the case the fake gets
  exactly one more call, for C (`To` = C), and none for B; the confirmation success counter is
  `2` (A, C).
- Cleanup behind the blocked send: the clock moves to `t=90000000` and the cleanup timer runs →
  the rows of A, B and C are deleted (`confirm_expires_at` `86400000`, `86400001`, `86400002`), and
  the gauge reads `1` at once (B and C removed; A's attempt is in flight and is not aborted, D12).
  Resolve A: the gauge reads `0`, and the fake gets no call for B or C. A wrong implementation
  that only drops jobs when the worker reaches them keeps the gauge at `3` while A is blocked and
  fails here.
- Rotation: B subscribes again at `t=600001` (L3 passed: `600001 - 1 >= 600000`) while A is
  blocked → `202`, and the gauge stays `3` (B's old job is replaced, not added). Resolve A: B gets
  exactly one mail; the SHA-256 of the token in its confirm link equals B's `confirm_digest`
  after the rotation and differs from the digest read before it (both read through the second
  connection).
- Expiry without cleanup: the clock moves to `t=86400001` with the cleanup timer held (not run).
  Resolve A: B's job is dropped before its attempt (`now >= expiresAt = 86400001`), the fake gets
  no call for B, and C (`expiresAt = 86400002`) gets its mail. The literal boundary catches an
  off-by-one (`>` instead of `>=`).
- Job in its retry wait (`PULSE_NOTIFY_RETRY_DELAY_MS = 1000`): in this case the fake rejects
  A's attempt 1 at `t=3` with a temporary error, so A stays queued with `notBefore = 1003`
  (`retryDelay(1, 1000, 60000) = 1000`). A is not ready, so B's attempt is the fake's next call
  at once (still `t=3`), and the fake holds it. Unsubscribe A at `t=10` → `200`, the gauge reads
  `2` right after the answer (B in flight, C queued). Move the clock to `t=2000` and resolve B:
  the fake's next call is C's, and over the whole case the fake's calls for A stay `1` (no attempt
  2). A wrong implementation that keeps a cancelled job until its retry time sends A's attempt 2
  at `t=1003` and fails the count; one that holds B behind A's retry wait makes B's call only at
  `t=1003` and fails the "next call at `t=3`" check.
- In-flight boundary: unsubscribe A while A's attempt 1 is in flight → `200`; the `signal` passed
  to the fake for A is not aborted. Resolve A: A gets no further attempt. Timeouts: with
  `PULSE_NOTIFY_TIMEOUT_MS = 120000` the fake receives `timeoutMs = 60000`; with the default it
  receives `5000`.

### One send per mailbox (D20), two workers and re-subscription

Fixture for each case (`test/subscriptions-mailbox.test.ts`; injected clock and sleep, fake api
with a manual feed, test key and token files, `mkdtemp` store, the baseline already seeded by one
empty poll, `PULSE_NOTIFY_RETRY_ATTEMPTS = 3`, `PULSE_NOTIFY_RETRY_DELAY_MS = 1000`). Mailbox M
is `sub-m@example.com`, mailbox N is `sub-n@example.com`. The fake `sendMail` records every call
with its `To`, the order in which calls start and settle, and per `To` address the number of
calls started and not yet settled; it keeps the largest value of that number per address. After
every step the test asserts that this largest value is at most `1` for M and for N (literal
`1`), so the check is on the mailbox the mailer sees, not on a row. A confirmation token is read
from the message of the call that carried it (the mail was handed to the server, so the visitor
may have it). The test builds unsubscribe tokens from row ids (read through a second connection)
and the test key with its own `node:crypto` HMAC. Every expected value is a literal in the test.

- Spelling: the test first asserts `normalizeSubscriberEmail(" SUB-M@Example.COM ")` is
  `"sub-m@example.com"` (literal) and that the guard's `key` gives the same 64-hex string for
  the stored address of M1 and of M2 below. The wire carries only the normalized form (R1), so
  the re-subscribe steps send that result, as status does.
- **Old confirmation held, confirm, detect, unsubscribe, re-subscribe** (issue review check 10):
  M subscribes at `t=0` (row M1); the fake holds M1's confirmation attempt. Confirm M1 at
  `t=10` → `200`. The fake api publishes incident E1 and one poll runs at `t=20` → detections
  `+1`, `events_pending` `1`; worker 2 waits on M's entry, so the fake still has `1` call.
  Unsubscribe M1 at `t=30` → `200`. Re-subscribe M at `t=40` → `202`, a new `pending` row M2
  with an id different from M1's; the gauge `confirmations_queued` reads `2` (M1's attempt in
  flight, M2 queued). The fake still has exactly `1` call. Settle M1's attempt with success at
  `t=50` → worker 2 re-reads M1, finds it gone and skips it (`events_pending` reaches `0`, the
  incident counters stay `0`); then M2's confirmation call is the fake's 2nd call, and its start
  comes after M1's settle in the fake's order. Over the case: `2` calls, both to M, max in
  flight for M `1`, `0` delivery rows. In this case worker 1 is busy with M1's attempt, so M2
  waits by worker 1's one-attempt rule as well; the next case is the one that only the mailbox
  guard can pass.
- **Mirrored: old incident send held, new confirmation queued.** M subscribes at `t=0` (M1), the
  fake resolves its confirmation at once, M1 confirms at `t=10`. Incident E1 is detected at
  `t=20`; the fake holds M1's incident send. Unsubscribe M1 at `t=30` → `200`. Re-subscribe M at
  `t=40` → `202` (row M2); N subscribes at `t=41` → `202`. Then: N's confirmation call is the
  fake's next call at once (another mailbox progresses), the fake has no call for M2, and the
  gauge reads `2` (M2 deferred, N in flight). Resolve N's call. The fake still has no call for M2
  and the largest in-flight count for M is `1`. Then settle M1's incident send, once per subcase:
  - success → incident success counter `1`; M2's confirmation is the fake's next call for M;
  - `PermanentDeliveryError` (550) → incident failure counter `1`; M2's confirmation next;
  - temporary error → M2's confirmation next; E1 is `done` with `passes = 1` and the injected
    sleep was asked for `0` times (M1 is gone, D21);
  - timeout (the fake never settles; the injected timer fires at `timeoutMs`) → M2's
    confirmation next, and the guard's `size()` is `1` (M2's attempt) right after it started;
  - stop at `t=50` instead of a settle → the `signal` given to the fake for M1's send is aborted;
    after stop resolved, the fake has no call for M2 and `size()` is `0`.
  In every subcase: `SELECT count(*) FROM deliveries WHERE subscription_id IN (<M1>, <M2>)` is
  `0`, the orphan invariant of D21 is `0`, and M2's confirmation call (when there is one) starts
  after M1's settle in the fake's order. A wrong implementation that keys the guard by row id
  starts M2's confirmation at `t=40`, while M1's incident send is open: the largest in-flight
  count for M is `2` against the literal `1`, and the case fails.
- **Same sequence without the unsubscribe**: M1's confirmation held, confirm, E1 detected;
  resolve the confirmation attempt → only then the fake gets its second call, the incident mail
  to M; the largest in-flight count for M stays `1`; the incident success counter is `1`.
- **Confirm during the retry wait**: the fake rejects M1's confirmation attempt 1 with a temporary
  error (the message was still handed over, so the test has the token); M1 waits for
  `notBefore`. Confirm M1 → `200`: the gauge reads `0` at once; the clock then passes
  `notBefore` and M1 makes no attempt 2 (the fake's confirmation calls for M stay `1`); both
  confirmation counters stay `0` (a cancelled job is counted in neither, R5). A wrong
  implementation that keeps the job sends a second confirmation mail to a confirmed row and fails
  the count.
- **Worker 1 is not blocked by another mailbox**: M1 is confirmed, E1 is detected, and the fake
  holds the incident send to M; then N subscribes → N's confirmation call is the fake's next call
  at once, and the largest in-flight count stays `1` for both addresses.
- **Held mailbox: no elapsed wake, other mailboxes progress** (R5 "Wake rule"). In this case the
  injected sleep is a recording sleep: it records each `ms` it is called with and the number of
  its calls that are still pending; for `ms <= 0` it resolves at once (as `setTimeout` does),
  else it waits until the test resolves it or its `signal` aborts. "Let the loop run" means
  `100` turns of `await new Promise((r) => setImmediate(r))`. Steps, with literals:
  1. M subscribes at `t=0` (M1); the fake resolves its confirmation at once; confirm M1 at
     `t=10`. Incident E1 is detected at `t=20`; the fake holds M1's incident send. Unsubscribe
     M1 at `t=30` → `200`; re-subscribe M at `t=40` → `202` (row M2, `notBefore = 0`, held by
     M's entry). Let the loop run, read worker 1's `selections` as `s0`, let the loop run again:
     `selections` is still `s0` (growth `0`), the sleep record is `[]`, and the fake has no
     call for M2.
  2. N subscribes at `t=41` → `202`; let the loop run: N's confirmation is the fake's next call.
     The fake rejects it at `t=42` with a temporary error, so N's `notBefore` is
     `42 + 1000 = 1042`. Let the loop run: the sleep record is exactly `[1000]` (`1042 - 42`), one
     sleep is pending, and `selections` does not grow over a further run of the loop.
  3. Set the clock to `t=500` and resolve the pending sleep; let the loop run: the record is
     `[1000, 542]`, N has made no attempt 2, and no call for M2 exists.
  4. Set the clock to `t=1042` and resolve the pending sleep; let the loop run: N's attempt 2 is
     the fake's next call and the record stays `[1000, 542]` (at the exact deadline the job is
     ready, so no sleep of `0`). Resolve N's attempt 2 with success.
  5. Settle M1's incident send with success at `t=1100`; let the loop run: M2's confirmation is
     the fake's next call, started by the guard's settle and not by a sleep (the record stays
     `[1000, 542]`), and the largest in-flight count for M is `1`.
  Over the case: every recorded value is at least `1`, at most `1` sleep is pending at any
  check, and `0` sleeps are pending after stop. A wrong implementation that sleeps until the
  earliest `notBefore` of every waiting job calls the sleep with `0 - 40 = -40` (or `0`) in
  step 1, so its record is not `[]` and, because such a sleep resolves at once, `selections`
  keeps growing across the loop run; it fails both literals. One that waits only on the sleep,
  without `waitFor`, does not start M2 in step 5 and fails there. One that does not abort the
  previous round's sleep leaves `2` pending in step 3.
- **Stop while worker 2 waits on M's entry**: stop ends the wait, E1 stays `pending`, no delivery
  row is written for M, and the fake has no incident call for M.
- **Owner check** (guard unit cases, literal values): `tryAcquire(k)` → owner `1`;
  `release(k, 1)`; `tryAcquire(k)` → owner `2`; a late `release(k, 1)` → `size()` stays `1` and
  `tryAcquire(k)` → `undefined`; `release(k, 2)` → `size()` `0`. After `stop()`, `tryAcquire`
  of a free key → `undefined`. Two guards (two salts) give different keys for one address, and no
  key contains the address or its local part.
- **Map hygiene**: after each case of this block, of "Confirmation queue (D19)" and of "Late
  completion after delete (D21)", `size()` is `0`; an attempt that hits the D12 timeout releases
  its entry.

### Late completion after delete (D21)

Fixture for each case (injected clock and sleep, fake api with a manual feed, test key and token
files, a `mkdtemp` store file, the baseline already seeded by one empty poll,
`PULSE_NOTIFY_RETRY_ATTEMPTS = 3`): A and B are `confirmed` (A's id sorts before B's; the test
picks the two ids). B already has a delivery row `sent` for the event E1 (written through a
second connection), so A is E1's only eligible row. One poll detects E1. The fake `sendMail`
returns, for its first call (A's incident send), a promise that the test holds unresolved. The
test then unsubscribes A → `200`, and only after that settles the held send as the case says.
Every check reads the store through a second connection to the same file. Every expected value
is a literal in the test.

- Late success: settle with success → `SELECT count(*) FROM subscriptions WHERE id = <A>` is `0`,
  `SELECT count(*) FROM deliveries WHERE subscription_id = <A>` is `0`; the incident success
  counter is `1` (SMTP took the message); E1 is `done` with `passes = 1`;
  `pulse_notify_subscriber_events_pending` reads `0`; the injected sleep was asked for `0` times;
  the fake has exactly `1` call for A. A wrong implementation with an unguarded insert leaves `1`
  delivery row with A's id and fails the `0`.
- Late permanent failure: settle with a `PermanentDeliveryError` (550) → the same `0` row
  counts; the incident failure counter is `1`; E1 is `done` with `passes = 1`; no second call
  for A.
- Late temporary failure: settle with a temporary error → `0` delivery rows for A; E1 is `done`
  after pass 1 (`passes = 1`, `next_pass_at` stays `NULL`), the injected sleep was asked for `0`
  times, and the fake gets no second call for A. A wrong implementation that keeps the deleted
  row in the pass's eligible list sleeps for `1000` ms (`PULSE_NOTIFY_RETRY_DELAY_MS`) and runs
  pass 2.
- Late timeout: the fake never settles and the injected timer fires at `timeoutMs` → the same
  result as the temporary failure; `inFlight` is empty afterwards.
- Resubscribed address: after the unsubscribe and before the send settles, A's address subscribes
  again → `202`, a new `pending` row A2 with a new id. Settle with success → `0` delivery rows for
  A's old id and `0` for A2's id; A2 stays `pending` and gets its confirmation mail only, and that call starts after the held send settled (D20).
- Progress: with a second pending event E2 behind E1 that B has not had, E2's send to B is the
  fake's next call after A's send settled, in each case above.
- Erasure: after the late success and E1's `done` write, a search of the bytes of the store
  file and of its `-wal` file for A's address and for A's id finds nothing.
- Worker 1: a confirmation attempt for a `pending` C is held unresolved; C unsubscribes (`200`,
  with C's unsubscribe token built by the test from C's id and the test key); the attempt then
  settles with success → `SELECT count(*) FROM subscriptions WHERE id = <C>` is `0`, and the
  second connection's `PRAGMA data_version` reads the same value right after the unsubscribe
  answer and after the settle (no other connection committed in between: worker 1 writes
  nothing, R5).
- Invariant, checked after every case of this block, of "One send per mailbox (D20)" and of
  "Fan-out failures": `SELECT count(*) FROM deliveries d WHERE NOT EXISTS (SELECT 1 FROM
  subscriptions s WHERE s.id = d.subscription_id)` is `0`.

### No enumeration (R8), at every limit and below it

Each case compares two answers byte for byte (status code, every header except `date`, body):
the answer for a known address K and for an unknown address U, from a fresh fixture each time so
the first request cannot change the second's state, in both orders (K then U, U then K). Notify
cases compare notify's answers; status cases compare status's answers.

| Case | Fixture | K | Must also hold |
| --- | --- | --- | --- |
| below every limit | empty window, 1 row | confirmed; pending in cooldown; pending at send cap; expired pending | U gets a row and a mail |
| L1 full | `MAX = 2`, `MAX_PENDING = 2` (the default `1000` would break `MAX_PENDING <= MAX`), 2 rows | confirmed; pending | U: no row, no mail; K unchanged; `limited_total{limit="capacity"}` `+1` per U request |
| L2 full | `MAX = 10`, `MAX_PENDING = 1`, 1 pending row | confirmed; the pending row | U: no row |
| L3/L4 | pending K in cooldown / at 3 sends | — | U below other limits gets a mail; the answers are still equal |
| L5 full | `CONFIRM_PER_HOUR = 1`, one mail queued | confirmed; pending past cooldown | neither gets a mail |
| L6 full | 100 jobs queued (fake `sendMail` that never resolves) | confirmed; pending past cooldown | neither gets a mail |
| L0 full (status) | fake notify that holds 8 calls | any | the 9th request makes no call |
| L8 (status) | fake notify that never answers | any | same answer as for a `202`, written at the release; the fake sees its request aborted (when the test fires the call's `1500` timer, or at the release when it does not) |
| L9 full (status) | 256 admitted: 128 answers waiting for release and 128 partial bodies (manual scheduler, not fired) | any, valid or invalid address | both `503` busy pages byte-equal; the fake notify gets no call for either |
| L9 one below (status) | 255 admitted, the same mix with 127 partial bodies | any | both take the release path (one release timer each) and are byte-equal at release |
| notify outcomes (status) | fake notify answers `202`, `400`, `401`, `429`, `503`, `302`, `200` with a bad body, `202` with `x-pulse-contract: 2`, a closed socket | — | all nine answers are byte-equal to each other |

At status, "known" and "unknown" are simulated by the fake notify, which treats K and U
differently on purpose (for example `202` at once for K and no answer for U); status must not
pass that difference on. A wrong implementation that answers `429` or `503` only when the store
has no row for the address, or that sets a header (`retry-after`, `set-cookie`) only on one path,
fails here. Every row is also run through the timing checks of the next block.

### Response timing (D22), below and at every limit

Status cases (`src/subscribe-timing.test.ts`): a real status server on port 0 with a manual
scheduler (`schedule` records each `(fn, ms)` with the manual clock's time and returns a cancel;
nothing fires unless the test fires it) and a manual clock, and a fake notify on port 0 whose
behavior per address is set by the case. The client uses a raw `node:net` socket so the test sees
whether any byte arrived. For each case, the test sends K, P (pending) and U in this order and,
from a fresh fixture, in the order U, P, K. It sends them one at a time: it waits until the
request's last expected timer is registered (and, when a call is expected, until the fake notify
received it) before it sends the next, so every timer registered in between belongs to that
request. The manual scheduler keeps cancelled timers in its record, marked cancelled, and never
fires them. The test asserts, with the literals in the test:

1. the request's timers, in registration order, are exactly `[5000, 2000, 1500]` for a request
   that calls notify and exactly `[5000, 2000]` for a request skipped by L0. `5000` is the body
   deadline: it is cancelled before `2000` is registered. `2000` is the release timer: it is
   registered at the clock value at which the address passed (`t0`), before the call's timer and
   before the fake notify received the call (the fake records the scheduler's count when the call
   arrives). `1500` is the call's own timeout (`requestJson`, `SUBSCRIBE_CALL_TIMEOUT_MS`). The
   list counts registrations, cancelled ones included; the number of the request's live timers
   (registered, not fired, not cancelled) is never more than the literal `2`, read after each
   registration;
2. after the fake notify finished with the request (answered, failed, redirected, closed, or, for
   L0, after the request's two registrations `[5000, 2000]` were recorded) and after the test fired the request's
   `1500` timer when it was not cancelled yet (the call then ends as a timeout, and the fake
   sees that call aborted when it had not answered), the socket has received `0` bytes;
3. when the test fires the `2000` timer, the socket receives the whole answer, and the three
   answers are byte-equal except `date`;
4. in the cases where the test fires the `2000` timer while the call is still open (the fake has
   not answered and the `1500` timer was not fired), the fake sees the call aborted at the
   release, and the `1500` timer is then marked cancelled.

Cases: fake notify answers `202` at once for K and P and `202` for U only after the test's step
`n` (a deliberate difference); answers `202` for K and closes the socket for U; answers `503` for
P and `302` for U; answers `200` with a bad body for K; never answers for anyone (run once with
the `1500` timers fired before the release and once without); L0 full (8 calls held, so the
three requests make no call); L9 one below (255 admitted). A wrong implementation that writes the
answer when notify answers (an early return for K) fails check 2; one that writes it when the
call's timeout fires fails check 2; one that registers the release timer only after notify
answered, or after the call started, or with another delay for one path, fails check 1; one that
keeps `timeoutMs = SUBSCRIBE_RELEASE_MS` for the call registers `[5000, 2000, 2000]` and fails
check 1.

Requests refused before the address: L9 full, `403` and `415` register `0` timers; `413`, `400`
fields and `400` address register exactly `[5000]`, cancelled when the body ended, and no `2000`
or `1500` timer. All of them are answered without the test firing any timer, the same for every
address.

Notify cases (`test/subscriptions-enumeration.test.ts`): the real listener on `127.0.0.1:0` with a
manual clock and a recording scheduler; the fake `sendMail` holds every call unresolved and the
fan-out has an event whose send is held, so SMTP and fan-out cannot end during the checks. For K
(confirmed), P (pending, in cooldown) and U, below every limit and at L1, L2, L5 and L6, in both
orders, from fresh stores:

1. the answer `202 {"status":"accepted"}` arrives while the manual clock still reads its start
   value (the test never advances it) and while every mailer call stays unresolved;
2. the scheduler recorded `0` timers between the request's arrival and the answer;
3. `subscribe()` returned a non-`Promise` for each request (the module is called directly with
   the same inputs as a second check).
A wrong implementation that sleeps for unknown addresses, or awaits the queued mail, never answers
under the frozen clock and held mailer; the test's own guard (a real 2000 ms limit per request,
used only to end the test, never to measure) then fails it.

### Root hosting (R9)

| Setting (with subscriptions on) | Result |
| --- | --- |
| `PULSE_STATUS_PUBLIC_URL=https://status.example.com` | accepted, origin `https://status.example.com` |
| `PULSE_STATUS_PUBLIC_URL=https://status.example.com/` | accepted, the same origin |
| `PULSE_STATUS_PUBLIC_URL=https://status.example.com/pulse` | exit `2`, the R9 line |
| `PULSE_STATUS_PUBLIC_URL=https://status.example.com/pulse/` | exit `2`, the R9 line |
| `PULSE_STATUS_PUBLIC_URL=https://u:p@status.example.com` | exit `2`, the existing credentials line |
| `PULSE_STATUS_PUBLIC_URL=https://status.example.com/?x=1` | exit `2`, the existing query line |
| the same `/pulse/` value with subscriptions off | accepted as `…/pulse`, as today |
| `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL=https://status.example.com/pulse` | exit `2`, the notify R9 line; no store file exists afterwards |
| `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL=https://status.example.com/` | the confirmation link is `https://status.example.com/subscribe/confirm?token=…` (one `/`, no `//subscribe`) |

- `POST /subscribe` with `Host: evil.example` and `X-Forwarded-Host: evil.example` → the
  confirmation mail's links start with the configured origin, not `evil.example`.

### Visitor notice and contact (R10)

- Contact `privacy@example.com` → the notice holds
  `<a href="mailto:privacy@example.com">privacy@example.com</a>`; `Privacy@Example.COM` → the same
  (normalized).
- Contact `https://example.com/privacy` → `<a href="https://example.com/privacy">`.
- Contact `http://example.com/privacy` (not https), `javascript:alert(1)`, `mailto:a@example.com`,
  `a@example.com, b@example.com`, a 513-character URL, an empty value → exit `2` naming
  `PULSE_STATUS_SUBSCRIPTIONS_CONTACT`; the error line holds no part of the value.
- Contact `https://example.com/?q="><script>` → accepted, rendered with `&quot;&gt;&lt;script&gt;`
  in the attribute and the text; the raw `<script>` does not appear.
- Subscriptions on and no contact → exit `2` naming `PULSE_STATUS_SUBSCRIPTIONS_CONTACT`.
- The notice holds the literal sentences of R10 with `25 hours` and `24 hours`; a wrong
  implementation that renders "24 hours" for the deletion time fails.

### Eligibility and privacy

- A pending (never confirmed) address: publish, update and resolve a public incident → 0 incident
  sends to it (only its confirmation mail exists).
- Confirmed at `t=1000`; an event detected at `t=1000` → sent (`<=`); detected at `t=999` → not
  sent.
- Incident published at `t=500` (detected at `t=500`), subscriber confirmed at `t=1000`, update
  detected at `t=2000` → only the update is sent.
- First enablement with three visible manual incidents → 0 sends; a new update after that → 1 send
  per confirmed row.
- A draft incident, a saved draft update, a note, and a published or resolved internal incident:
  the api feed does not list them → 0 events, 0 sends. A feed item with
  `"visibility":"internal"` that an older api leaks is dropped by `isPublicManualIncident` → 0
  events.
- Publishing the draft update later → exactly one `update` (or `resolved`) send per confirmed row.
- A manual incident that temporarily carries an explicit private flag and then is public again
  with the same updates → no second send (keys exist).
- Two confirmed rows: the message to row 1 has `To` = row 1's address only and does not contain
  row 2's address anywhere.

### Fan-out failures (fake `sendMail`, injected sleep)

- SMTP answers a temporary error for row 1 at pass 1; the test unsubscribes row 1 before pass 2;
  pass 2 makes 0 sends to row 1.
- Same, but notify stops after pass 1 and starts again with the same store; the resumed event makes
  0 sends to row 1 and 1 send to row 2 if it was not yet sent.
- A send that started before an unsubscribe ends with success; no further send to that row, and
  no delivery row of it (D21, block "Late completion after delete (D21)").
- Row 1 refused with 550 → delivery `failed` after 1 attempt; row 2 still gets the message.
- `PULSE_NOTIFY_RETRY_ATTEMPTS = 0` and row 1 always temporarily failing → after 12 passes row 1 is
  `failed` and the next event starts.
- Pass budget across restarts (`PULSE_NOTIFY_RETRY_ATTEMPTS = 3`, `RETRY_DELAY_MS = 1000`,
  `RETRY_MAX_DELAY_MS = 60000`, row 1 always temporarily failing, a second event E2 pending
  behind E1). The expected numbers are literals in the test:
  - Passes 1 and 2 run (row 1: 2 send attempts); stop during the sleep before pass 3; start a new
    worker on the same store → `passes` reads `2`; pass 3 runs (1 more attempt, 3 in total);
    row 1 is `failed` with `attempts = 3`; E1 is `done`; no 4th attempt; E2 starts.
  - Stop during pass 3, after `passes = 3` was committed and while the send to row 1 is in
    flight (the fake `sendMail` waits for the abort); start again → 0 sends for E1, row 1 is
    `failed` with `attempts = 3`, E1 is `done`, and E2's first send happens before any sleep.
  - The wrong implementation that keeps the pass count in memory makes a 4th, 5th, … attempt on
    each restart; this test catches it by counting the fake's calls for row 1 (`3`, not more).
  - Stop at `t = T` during the sleep before pass 2, whose `next_pass_at` is `T + 400`
    (stored after pass 1 at `T - 600` with `retryDelay(1, 1000, 60000) = 1000`); start again at
    `t = T + 100` → pass 2 starts at `t = T + 400` (the injected sleep is asked for `300` ms),
    not at `T + 1100`.
  - Ten restarts in a row, each right after the worker started → E1 still gets at most 3 pass
    starts and is `done` when `passes = 3`.
- 250 confirmed rows → the store is read in 3 pages; every row gets one send; no two sends for one
  row.
- Restart after an event is `done` → 0 new sends for it.

## Contract fields

New names, and the search that shows that each is free in the contract and config clones
(run from the meta checkout at contract `c5ce668` and config `bc87049`; every search printed
nothing):

```sh
grep -rn -i 'subscri' .repos/contract/src .repos/config            # no match (covers subscription, subscriber, SUBSCRIPTION_*, SUBSCRIBER_*)
grep -rn -i 'unsubscri' .repos/contract/src .repos/config          # no match
grep -rn '/subscribe' .repos/contract/src .repos/config            # no match
grep -rn 'CONFIRM_TTL\|CLEANUP_INTERVAL' .repos/contract/src .repos/config   # no match
```

Contract (new module `src/subscriptions.ts`, validators in `src/validate-subscriptions.ts`):

| Name | Kind |
| --- | --- |
| `SUBSCRIPTION_ROUTES` | `{ subscribe: "/subscriptions", confirm: "/subscriptions/confirm", unsubscribe: "/subscriptions/unsubscribe" } as const` |
| `SUBSCRIPTION_MAX_BODY_BYTES` | `1024` |
| `SUBSCRIPTION_CONFIRM_TTL_MS` | `86400000` |
| `SUBSCRIPTION_CLEANUP_INTERVAL_MS` | `3600000` |
| `SUBSCRIBER_EMAIL_MAX` | `254` |
| `SUBSCRIPTION_CONFIRM_TOKEN_PATTERN` | `RegExp` |
| `SUBSCRIPTION_UNSUBSCRIBE_TOKEN_PATTERN` | `RegExp` |
| `SUBSCRIPTION_RESULTS` | `["accepted", "confirmed", "unsubscribed"] as const` |
| `normalizeSubscriberEmail` | function |
| `subscriptionRequestSchema`, `subscriptionTokenRequestSchema`, `subscriptionAnswerSchema` | zod schemas |
| `SubscriptionRequest`, `SubscriptionTokenRequest`, `SubscriptionAnswer`, `SubscriptionResult` | types |
| `validateSubscriptionRequest`, `validateSubscriptionTokenRequest`, `validateSubscriptionAnswer` | validators |
| JSON keys `email`, `token`, `status` | in the new shapes only |

Services and deploy (searched with `grep -rn -- '<name>' .repos/status/src .repos/status/public
.repos/notify/src .repos/deploy`): `PULSE_NOTIFY_SUBSCRIPTIONS` (covers `_MAX_PENDING` and every
other new notify variable), `PULSE_STATUS_SUBSCRIPTIONS` (covers `_CONTACT`), `PULSE_SECRETS_SUBSCRIPTIONS`,
`subscriptions-token`, `subscriptions-key`, `E2E_SUBSCRIPTIONS`, `pulse_notify_subscri` (covers
`_confirmations_queued` and `_limited_total`), `subscribers delete`, `subscribe-notice`,
`secure_delete`, `/subscribe`, `9300`, `subscriptions-smtp-password`, `subscriptions.example`,
`full-subs`: no match (the last three also with `grep -rn` over `.repos/deploy` and
`.repos/config`). `subscription`, `subscriber` and
`unsubscribe` appear only as unrelated words: a comment in `notify/src/metrics.ts:5`,
`notify/src/alert-poll.ts:19-34` (`isSubscribed`, channel alert opt-in; the new notify modules do
not reuse that name) and local `unsubscribe` variables in `deploy/cli/*.ts`. #570's spec uses
none of these names (`grep -n -i 'subscri' .factory/work/570/plan.md` shows only the non-goal
line 703).

Status routes `/subscribe`, `/subscribe/confirm`, `/unsubscribe`; the page anchors
`#subscribe` and `#subscribe-notice`; notify routes of `SUBSCRIPTION_ROUTES`; notify metrics of
R7; status variables of R6; notify variables of R3; the notify command `subscribers delete`
(next to the existing `failed`, `notify/src/index.ts:443`).

New in this version (status and notify internals, not contract exports), searched in this run with
`grep -rn -- '<name>' .repos/contract/src .repos/config .repos/status/src .repos/status/public
.repos/notify/src .repos/notify/test .repos/deploy`, each with no match: `SUBSCRIBE_RELEASE_MS`,
`SUBSCRIBE_MAX_ADMITTED` (the previous version's `SUBSCRIBE_MAX_WAITING`, renamed, which no clone
holds either), `SUBSCRIBE_CALL_TIMEOUT_MS`, `SUBSCRIBE_BODY_TIMEOUT_MS`, `dropSlowBody`,
`subscription request refused`, `mailbox-guard`, `tryAcquire`,
`subscribe-timing`, `subscriptions-mailbox`, `subscriptions-support`, and (added with R5 "Wake
rule") the worker field `selections`. The guard method `waitFor` matches only an unrelated
method of the test logger (`.repos/notify/test/reminders.test.ts:175,278,282`); the guard's
method lives on the guard object of `src/mailbox-guard.ts`, so the two do not meet. `grep -rn -i 'mailbox'
.repos/notify/src .repos/status/src .repos/contract/src` finds nothing either. The `ServerOptions`
member `schedule` of status is new there (`grep -n 'schedule' .repos/status/src/server.ts` finds
none); it reuses the type of the contract's existing `FetchJsonOptions.schedule`
(`contract/src/client.ts:40-41`), so the contract gets no new name for it.

## Repository: contract

Files:
- `src/subscriptions.ts` (new: constants, `normalizeSubscriberEmail`, schemas, types)
- `src/validate-subscriptions.ts` (new: the three validators)
- `src/index.ts` (changed: exports)
- `dist/subscriptions.js`, `dist/subscriptions.d.ts`, `dist/validate-subscriptions.js`,
  `dist/validate-subscriptions.d.ts`, `dist/index.js`, `dist/index.d.ts` (built)
- `test/subscriptions.test.ts` (new)
- `test/types.fixture.ts` (changed: the new types)
- `docs/index.md` (changed: a "Subscriptions" section with R1)
- `README.md` (changed: the list of shapes names subscriptions)
- `package.json` (changed: version, D13)

Behavior change: yes. New exported shapes, validators and an address rule.

Behavior:
- R1 exactly. `normalizeSubscriberEmail` is pure and never throws. The validators return the same
  object they get (`contract/AGENTS.md`, "This repository"). `SUBSCRIPTION_CONFIRM_TTL_MS` and
  `SUBSCRIPTION_CLEANUP_INTERVAL_MS` are plain `number` constants.
- `docs/index.md` documents that the subscribe route answers `202` for every valid request
  (R8) and that both time constants are what the status notice states (R10).
- `subscriptionRequestSchema` refines `email` with `normalizeSubscriberEmail(v) === v`.
- The token patterns are anchored and have no flags.

Checks:
- `test/subscriptions.test.ts`: every row of "Address rule" in Counterexamples with its literal
  expected value; the length bounds 254 and 255 and local 64 and 65; each validator accepts one
  valid literal and rejects a missing key, an extra key, a wrong type and a 129-character token;
  each pattern accepts one literal of the right length and rejects one character more and less
  and a `+`; `SUBSCRIPTION_CONFIRM_TTL_MS === 86400000` and
  `SUBSCRIPTION_CLEANUP_INTERVAL_MS === 3600000` (literals in the test).
- `bun run check` (`package.json:28`: lint, build, typecheck, test; read again at `c5ce668`). CI
  uses `lorenzh/pulse-config/.github/workflows/check.yml@51e95b0eb463b27a196a33b428607bd92443e4f0`
  with `build: true` (`.github/workflows/ci.yml:17-19`, the same at `c5ce668`). At that ref the workflow sets Bun 1.4.0
  (`check.yml:24`) and runs `bun install --frozen-lockfile` (`:26`), `bun run lint` (`:28`),
  `bun run typecheck` (`:30`), `bun run build` (`:33`), `git diff --exit-code -- dist` (`:36`) and
  `bun run test` (`:38`). The pinned file equals the config clone. Biome: `biome.json:2` extends
  `@lorenzh/pulse-config/biome.json`, whose `files.includes` (`config/biome.json:10-17`, same at
  the pin) checks everything but `dist`, `node_modules`, `bun.lock`, `*.html` and
  `test/fixtures`. Biome is `@biomejs/biome` `2.6.3` (`package.json:31`). Coverage: `bunfig.toml:2-3`
  (`lines = 0.8`).
- `test_cpu_s` and `build_cpu_s` per "Performance impact".

Completion evidence:
- The merged SHA and the version in the PR, for the status and notify pins.
- The output of `bun run check` and `git diff --exit-code -- dist` after `bun run build`.

## Repository: status

Files:
- `src/subscribe-routes.ts` (new: the routes of R2, origin check, form parsing, mapping of notify
  answers, the one subscribe answer, the release timer and `SUBSCRIBE_RELEASE_MS` (D22), the
  admission cap `SUBSCRIBE_MAX_ADMITTED` with its synchronous reservation, its free on response
  `close` and its body deadline `SUBSCRIBE_BODY_TIMEOUT_MS` (L9), the in-flight cap, and
  `SUBSCRIBE_CALL_TIMEOUT_MS` (L8))
- `src/subscribe-client.ts` (new: the call to notify with `requestJson`)
- `src/subscribe-pages.ts` (new: the form section with the R10 notice and contact link, and the
  result pages)
- `src/server.ts` (changed: `ServerOptions` gets the subscription options and `schedule` (R2
  "Release"); the method gate lets
  the three `POST` routes through when on; CSP `form-action`; the `{{subscribe}}` placeholder;
  `contractModules` adds `subscriptions.js` and `validate-subscriptions.js`, and every other module
  that the new contract's `index.js` imports, see `src/server.ts:189-206`)
- `src/settings.ts` (changed: R6, the contact rule, the R9 root rule)
- `src/start.ts` (changed: passes the settings and reads the token file)
- `public/index.html` (changed: `{{subscribe}}` after the maintenance list)
- `public/page.css` (changed: form and notice styles, readable at 360 px)
- `src/subscribe-routes.test.ts` (new: real server on port 0 with a fake notify on port 0)
- `src/subscribe-enumeration.test.ts` (new: the status cases of "No enumeration (R8)")
- `src/subscribe-timing.test.ts` (new: the status cases of "Response timing (D22)")
- `src/subscribe-test-support.ts` (new: the manual scheduler and clock, the fake notify on port 0
  and the raw-socket client shared by the three subscribe test files; `bunfig.toml:4` ignores only
  `*.test.ts`, `test/**` and `dist/**` for coverage, so this file counts like source and its
  lines are covered by those tests)
- `src/settings.test.ts` (changed)
- `src/server.contract-modules.test.ts` (changed only if the served list needs a new assertion)
- `e2e/run.ts` (changed: axe checks of the page with the form and of the five result pages, at 360
  and 1280 px, light and dark, with and without JavaScript)
- `README.md`, `docs/configuration.md`, `docs/operation.md` (changed: settings, routes, the root
  hosting rule of R9, the notice and operator duties of R10, known limits D-R3, D-R4, D-R9, D-R12,
  D-R10)
- `package.json`, `bun.lock` (changed: contract pin to the merged full SHA of the contract child)

Behavior change: yes. New public form, pages and `POST` routes when configured.

Behavior: R2, R6, R7 (status parts), R8 (status side: one subscribe answer, L0, L7, L8, L9, the
precedence), D22 (release class), R9 (status side), R10 (notice and contact). Off by default with
today's answers; with subscriptions off no release timer, admission count or `schedule` call
exists on any path.

Shared finding: the exact text of the notify answers and the order of the notify checks are fixed
by R1 and R4. If the status child finds a gap there, it records it as a shared finding; the notify
child reads it before it starts, and the other way round.

Checks:
- `src/subscribe-routes.test.ts`: every "Status routes" counterexample with its literal status
  code and the fake notify's call count; a valid subscribe sends exactly
  `{"email":"sub-a@e2e.invalid"}` with `Authorization: Bearer <token of the test file>` to
  `/subscriptions` (literals in the test); the confirm and unsubscribe `POST`s send `{"token":…}`
  to their routes; every page has `cache-control: no-store`, the CSP with `form-action 'self'`,
  `referrer-policy: no-referrer`; no answer body contains the submitted address; a hostile address
  text `<script>` is never echoed; the "Token exception" counterexample with its literal token:
  only the `200` `GET` link pages hold it, once, in the hidden field.
- `src/subscribe-enumeration.test.ts`: every status row of "No enumeration (R8)" (L0, L8, L9
  full, L9 one below and the nine notify outcomes), each comparing two real HTTP answers byte for
  byte (status, headers except `date`, body) for `sub-k@e2e.invalid` and `sub-u@e2e.invalid`, in
  both orders, with a new server and fake notify per case; the release timers are fired by the
  test through the manual scheduler. The test also asserts the literal subscribe answer text of R2
  (with `24 hours` and the contact link), and that the answer has no `location`, `retry-after`,
  `set-cookie` or `etag` header. The expected bytes are not read from the code under test: the
  test compares two answers to each other and checks the literal text.
- Notice (R10): `GET /` with subscriptions on holds each literal sentence of the R10 notice, with
  `25 hours` and `24 hours`, inside `id="subscribe-notice"`, between the input and the button,
  and the input's `aria-describedby="subscribe-notice"`; the "Visitor notice and contact"
  counterexamples with their literal outputs. The `400` invalid-address page holds the notice too.
- `src/subscribe-timing.test.ts`: every status case of "Response timing (D22)" with checks 1-4,
  for K, P and U in both orders, below every limit, at L0 and one below L9, and the "before the
  address" requests with `0` timers (`403`, `415`, L9 full) or exactly `[5000]` (`413`, `400`).
  Expected values are literals in the test (the registration lists `[5000, 2000, 1500]` and
  `[5000, 2000]`, cancelled timers included, at most `2` live timers per request, `0` bytes
  before the `2000` timer fires); none is read from
  `src/subscribe-routes.ts`. A self-check in the same file runs the checks against two
  deliberately wrong handlers written in the test (one answers as soon as the fake notify
  answers, one calls `requestJson` with `timeoutMs: 2000`) and expects check 2 and check 1 to
  fail, so the checks can fail.
- The "Status routes" cases for L9, unsubscribe and confirm at full L0 and L9, and a closed client
  socket, and every case of "Admission (L9), partial bodies" with its literals (`256` admitted
  and `1` refused out of 257 partial bodies, `256` body timers of `5000` ms and `0` of `2000` ms
  before the bodies end, the probe after each of the eight paths, back to `256` admitted after
  all closed), in `src/subscribe-routes.test.ts`. Its self-check runs the 257-request race
  against a wrong admission written in the test (check before the body, count after it) and
  expects `257` admitted, so the check can fail.
- Feature off: the four "Feature off" counterexamples.
- `src/settings.test.ts`: URL without token file → startup error naming
  `PULSE_STATUS_SUBSCRIPTIONS_TOKEN_FILE`; URL without `PULSE_STATUS_PUBLIC_URL` → error naming it;
  URL without contact → error naming `PULSE_STATUS_SUBSCRIPTIONS_CONTACT`; a token of 31
  characters → error; the error text never contains the token or the contact value; every status
  row of "Root hosting (R9)" with its literal result, and `status/src/settings.test.ts:93-99`
  unchanged (prefix accepted with subscriptions off).
- The contract graph test (`src/server.contract-modules.test.ts:107-134`) passes with the new pin.
- `bun run check` (`package.json:19`: lint, typecheck, test). Lint is `biome check . &&
  pulse-eslint . && pulse-workflows` (`package.json:15`); Biome `2.6.3` (`package.json:23`),
  `biome.json:2` extends `@lorenzh/pulse-config/biome.json` (`config/biome.json:10-17`, equal at
  the pin `04108fa…`, `package.json:24`). Coverage `bunfig.toml:2-3` (`lines = 0.8`). CI:
  `.github/workflows/ci.yml:18` uses `check.yml@04108fa0c67d9a79c0f6d1ade4dd78df3ad8a4a7`, which
  runs install, lint, typecheck and test with Bun 1.4.0 (`check.yml:24-38`; equal to the clone).
  The `a11y` job runs `bun run check:a11y` (`ci.yml:51-68`, `package.json:18`).
- `test_cpu_s` per "Performance impact".
- `e2e/run.ts` axe checks include the page with the form and notice (the contact as a mailto
  link) and the subscribe answer page, with no violations, like the existing pages.
- Once by hand: `bun start` with a fake notify (a tiny local server), subscribe, open the confirm
  link, press the button; report the commands, the codes and the time of the subscribe answer (about 2 s).

Completion evidence: `bun run check` and `bun run check:a11y` output; the PR names the contract SHA
and the manual run.

## Repository: notify

Files:
- `src/subscription-settings.ts` (new: R3 settings, the R9 root rule)
- `src/subscriber-store.ts` (new: the SQLite store, `secure_delete`, checkpoints, cleanup timer)
- `src/subscribers-cli.ts` (new: `subscribers delete`, D18)
- `src/subscription-server.ts` (new: the listener, R4)
- `src/subscription-requests.ts` (new: the operations of R5, pure over the store and the clock)
- `src/subscriber-mail.ts` (new: the two message builders, tokens, `Message-ID`)
- `src/subscriber-fanout.ts` (new: detection input, worker 1 with its selection, cancel and
  expiry rules, and worker 2 with the pass budget)
- `src/mailbox-guard.ts` (new: the mailbox send guard of D20, R5 "One send per mailbox")
- `src/index.ts` (changed: wiring, second lock, listener start before the notifier, stop order
  (guard stopping, then workers, then listener, then store), the `subscribers` command next to
  `failed` at `:443-444`)
- `src/notifier.ts` (changed: hands each good manual read and `listedIds` to the fan-out)
- `src/metrics.ts` (changed: R7 series, rendered only when subscriptions are on)
- `Dockerfile` (changed: `PULSE_NOTIFY_SUBSCRIPTIONS_HOST=0.0.0.0` next to the health host)
- `test/subscriptions-settings.test.ts` (new)
- `test/subscriptions-store.test.ts` (new)
- `test/subscribers-cli.test.ts` (new)
- `test/subscriptions-server.test.ts` (new)
- `test/subscriptions-enumeration.test.ts` (new: R8 byte comparisons and the notify timing cases
  of D22)
- `test/subscriptions-fanout.test.ts` (new)
- `test/subscriptions-mailbox.test.ts` (new: the guard unit cases and the block "One send per
  mailbox (D20)")
- `test/subscriptions-security.test.ts` (new)
- `test/subscriptions-support.ts` (new: the recording fake mailer with per-address in-flight
  counts, the manual clock, sleep and scheduler, the unsubscribe-token builder and the
  second-connection store reader; used by the new test files; `test/support.ts` and
  `test/smtp-stub.ts` are used unchanged)
- `test/index.test.ts` (changed: startup and stop with subscriptions on and off, and the
  `subscribers` command routing)
- `test/metrics.test.ts` (changed: the R7 series with subscriptions on; the existing exact-text
  test of the series with subscriptions off, `test/metrics.test.ts:22`, stays unchanged)
- `README.md`, `docs/configuration.md`, `docs/operation.md`, `docs/channels/email.md` (changed:
  settings, the listener, the root hosting rule (R9), the data inventory and retention of R10,
  the per-mailbox in-flight bound of D20, `subscribers delete` and the operator procedure for a
  deletion request, known limits D-R1..D-R13, backup of the store)
- `AGENTS.md` (changed: the new modules in "This repository"; the ledger line says format 4, not
  3, as `src/ledger.ts:31` has; `AGENTS.md:105` says format 3 today)
- `package.json`, `bun.lock` (changed: contract pin to the merged full SHA)

This list is the complete inventory of the notify child (issue requirement). Every task of the
notify breakdown names only files of this list, and every file of this list is named by one task.
Each check below names the file it runs in. Existing test files that are not in the list
(`test/notifier.test.ts`, `test/ledger*.test.ts`, `test/failed-cli.test.ts` and the others) do not
change and must stay green.

Behavior change: yes. A new listener, store and subscriber mail when configured.

Behavior: R3, R4, R5, R7, R8 (notify side: `202` for every valid subscribe request, L1-L6, the
immediate class of D22), D20 (one send per mailbox), D21, R9 (notify side), R10 (inventory and
retention as stored). With `PULSE_NOTIFY_SUBSCRIPTIONS` unset,
the service, its ledger, its channels, `failed list|resend`, `/healthz`, `/readyz` and `/metrics`
behave exactly as on `main`; only the new `subscribers delete` command exists.

Shared finding: as in the status section, the wire texts are fixed by R1 and R4; a gap found by
either child is a shared finding that the other reads first.

Checks (fake `sendMail` from `test/subscriptions-support.ts`, the SMTP stub of
`test/smtp-stub.ts` where a real SMTP exchange is needed, the fake api of `test/support.ts:104`,
injected clock, sleep and scheduler, `mkdtemp` stores). Every counterexample is written with its
literal expected codes, outputs, row counts and send counts in the test. Per file:
- `test/subscriptions-settings.test.ts`: the "Settings" check below and the notify rows of "Root
  hosting (R9)".
- `test/subscriptions-store.test.ts`: schema, `user_version`, the cleanup and retention check
  below, "Lifecycle and timing" (operations called directly with the injected clock).
- `test/subscribers-cli.test.ts`: every "`subscribers delete`" counterexample.
- `test/subscriptions-server.test.ts`: every "Notify listener" counterexample over real HTTP on
  `127.0.0.1:0`, every answer typed with the contract validators.
- `test/subscriptions-enumeration.test.ts`: the enumeration check below and the notify cases of
  "Response timing (D22)".
- `test/subscriptions-fanout.test.ts`: "Confirmation queue (D19)", "Late completion after delete
  (D21)", "Eligibility and privacy", "Fan-out failures", the pass budget and the detection
  counter checks below, and the three issue acceptance tests.
- `test/subscriptions-mailbox.test.ts`: every case of "One send per mailbox (D20)", with the
  largest in-flight count per address (literal `1`) asserted after every step, and the orphan
  invariant of D21 after every case. A self-check in the same file swaps in a guard keyed by row
  id (written in the test) for the mirrored case and expects the largest count `2`, so the check
  can fail. The case "Held mailbox: no elapsed wake, other mailboxes progress" asserts the sleep
  records `[]`, `[1000]`, `[1000, 542]` (literals), no recorded value below `1`, `selections`
  growth `0` while every waiting job is held, and N's calls and M2's call in the stated order. A
  second self-check runs step 1 against a worker written in the test that sleeps until the
  earliest `notBefore` of all waiting jobs, bounded to `1000` selection steps, and expects the
  record to be non-empty with a value below `1`, so the check can fail.
- `test/subscriptions-security.test.ts`: the security check below.
- `test/index.test.ts` (it already starts the service with `main(env, deps)`,
  `src/index.ts:138`, and spawns the entry point, `test/index.test.ts:4,318`): with
  subscriptions off, `main` opens no subscription store, lock or listener (the state directory
  holds only the ledger files afterwards, literal file list); with subscriptions on and valid
  settings, the listener answers `401` on `127.0.0.1:<port>` before the first poll, and the store
  and `<store>.lock` exist with mode `0600`; stop releases the store lock (a second `main` on the
  same directory starts) and the guard's `size()` is `0` afterwards; with
  `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL=https://status.example.com/pulse`, `main` throws the
  `ConfigError` with the R9 line and no store, lock or listener exists. The entry point routes
  `subscribers` next to `failed` (`src/index.ts:443-444`): the spawned
  `bun src/index.ts subscribers` prints `usage: pulse-notify subscribers delete <address>` and
  exits `1`; `bun src/index.ts subscribers delete a@example.com` while a running `main` holds the
  store lock exits `2`.
- `test/metrics.test.ts`: with subscriptions on, the R7 series render with their names, help
  texts and labels (literal lines in the test, for example
  `pulse_notify_subscription_limited_total{limit="capacity"} 2`); with subscriptions off, the
  existing exact-text test at `test/metrics.test.ts:22` passes unchanged, so no new series appears.
- Completion write (D21): the late-completion cases run in `test/subscriptions-fanout.test.ts`
  against a real store file, and the orphan-delivery invariant query (literal `0`) runs after
  every fan-out case of that file. A grep of `src/` for `INSERT INTO deliveries` finds only the
  guarded statement of R5 and the finalize step's `INSERT … SELECT`.
- `test/subscriptions-fanout.test.ts`, fan-out holds one address at a time: with 250 confirmed rows and a fake `sendMail` held on the
  first send, the test unsubscribes row 2 (by id order) and then resolves the send; row 2 gets no
  send (the row is read by id right before each send, R5 "Fan-out").
- `test/subscriptions-enumeration.test.ts`: every notify row of "No enumeration (R8)" (below
  every limit, L1, L2, L3/L4, L5, L6, store error), each with a fresh `mkdtemp` store, real HTTP to
  the listener, both orders, comparing the two answers byte for byte (status, headers except
  `date`, body) and asserting the literal `{"status":"accepted"}`. After each case the test
  checks the store and the fake sender: rows and mails exactly as the table's "Must also hold"
  column says (literal counts), and a confirmed K is still `confirmed` with the same `id`.
- `test/subscriptions-store.test.ts`, cleanup and retention: the "Cleanup boundaries" counterexample with a fake timer; a deleted row
  leaves no trace in a second connection, and after the checkpoint the `-wal` file has size `0`;
  a search of the store file's bytes for the deleted address finds nothing (secure delete).
- `test/subscriptions-settings.test.ts`, R9: the notify rows of "Root hosting (R9)" with their literal results; the refused start leaves
  no store file, no lock file and no listener.
- `test/subscriptions-fanout.test.ts`, the acceptance tests that the issue names: (1) an unconfirmed address gets 0 incident sends while
  a confirmed one gets 3 (opened, update, resolved) for the same incident; (2) after unsubscribe
  the address gets 0 sends for a new incident while a second confirmed address gets 1; (3) a draft,
  a draft update, a note and an internal incident in the api's private data (served by the fake
  api only under `/admin`, not in `/manual-incidents`) produce 0 sends, and publishing the draft
  produces exactly 1 per confirmed address.
- `test/subscriptions-server.test.ts` starts the real listener on `127.0.0.1:0` and types every answer with the contract
  validators.
- `test/subscriptions-security.test.ts`: the store file and its lock are mode `0600`; no log line
  (captured logger) holds the address, a token, the key or the bearer token after a full flow with
  a failing SMTP; the metric output holds no address; a confirmation and an incident message have
  exactly one `To` address and no CR/LF in `Subject`; no listener answer body (every route, every
  status code of R1) holds the request's token or address.
- `test/subscriptions-fanout.test.ts`, pass budget: every "Pass budget across restarts" counterexample, each with a real stop and a
  new worker over the same `mkdtemp` store file (not the same object), and the fake's call count
  per row as a literal.
- `test/subscriptions-fanout.test.ts`, `pulse_notify_subscriber_detections_total`: grows by 1 per poll whose manual read answered
  (also a seeding poll and a poll with no new key); does not grow on a manual-feed error or a
  404; grows only after the event rows are readable from a second connection to the store.
- `test/subscriptions-fanout.test.ts`, `pulse_notify_subscriber_confirmations_queued`: `1` while a confirmation send waits (fake
  sender held), `0` after it resolved, and the success counter grew by exactly `1` before the
  gauge reached `0`.
- `test/subscriptions-settings.test.ts`, settings: `PULSE_NOTIFY_SUBSCRIPTIONS_MAX=5` with `PULSE_NOTIFY_SUBSCRIPTIONS_MAX_PENDING`
  unset (default `1000`) → exit `2` naming `PULSE_NOTIFY_SUBSCRIPTIONS_MAX_PENDING`; `MAX=5`
  with `MAX_PENDING=6` → the same; `MAX=5` with `MAX_PENDING=5` (the e2e overlay values) →
  accepted. SMTP login (literal values in the test): `SMTP_PASSWORD_FILE` without
  `SMTP_USERNAME` → exit `2` naming `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE`;
  `SMTP_USERNAME` without the file → exit `2` naming the same variable; a username with
  `SMTP_TLS=none` and host `mailpit` → exit `2` naming `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_TLS`, and
  with host `127.0.0.1` → accepted; a password file holding `s3cret-pw\n` with a username →
  accepted and the fake `sendMail` receives `password: "s3cret-pw"`; an empty file or one with two
  lines → exit `2`, and no error line holds `s3cret-pw` or the file's content. Each required
  variable missing → exit `2` naming it; a key of 63 or 65 hex characters, or with upper case →
  error; `off` opens no file (the test passes a state directory
  without write permission).
- Existing suites stay green unchanged, also `test/ledger*.test.ts` (the ledger is not touched).
- `bun run check` (`package.json:17`: lint, typecheck, test); lint `biome check . && pulse-eslint .
  && pulse-workflows` (`package.json:14`); Biome `2.6.3` (`package.json:21`); `biome.json:2`
  extends the shared config (`config/biome.json:10-17`, equal at pin `04108fa…`,
  `package.json:22`); coverage `bunfig.toml:2-3`. CI `.github/workflows/ci.yml:18` uses
  `check.yml@04108fa…` (install, lint, typecheck, test with Bun 1.4.0, `check.yml:24-38`, equal to
  the clone), and the `docker` job builds the image (`ci.yml:20-40`).
- `test_cpu_s` and the feature-on measurement per "Performance impact".
- Once by hand: `bun run start` with subscriptions on, a local fake api and a local SMTP stub;
  subscribe with `curl`, confirm with the token from the stub, create a manual incident in the fake
  api; report the commands and that the stub received one confirmation and one incident message.

Completion evidence: `bun run check` output; the measurements; the manual run; the contract SHA.

## Repository: deploy

Files:
- `scripts/init-secrets.sh` (changed: `make_token subscriptions-token` and `make_token
  subscriptions-key`, same format as today: 64 lowercase hex and a newline)
- `scripts/init-secrets.test.sh` (changed: both files exist, mode `0600`, 64 hex, differ from
  every other secret, are kept on a rerun, are never printed; no `subscriptions-smtp-password` is
  created)
- `scripts/secrets-init.mjs` (changed: `PULSE_SECRETS_SUBSCRIPTIONS`, the two secrets and the
  optional SMTP password, D14)
- `scripts/secrets-init.test.sh` (changed: the subscription cases, also for the password)
- `full/subscriptions.example.yaml` (new: the operator override for subscriptions on `full`,
  copied to the gitignored `full/compose.override.yaml`, `.gitignore:7`)
- `full/.env.example` (changed: `# PULSE_STATUS_PUBLIC_URL=`, read only by that override)
- `e2e/compose.subscriptions.yaml` (new, test only)
- `e2e/subscriptions.sh` (new: the scenario)
- `e2e/subscriptions.test.sh` (new: the scenario's parsing helpers on fixed mailpit answers, and
  `docker compose ... config --quiet` of the overlay with both base files, and the `config` checks
  of `full/subscriptions.example.yaml`)
- `e2e/compose-e2e.sh` (changed: the step "Email subscriptions" after "Console probe locations"
  and before "Persistence across down and up", `e2e/compose-e2e.sh:1097-1121`)
- `scripts/check-setup.sh`, `scripts/check-setup.test.sh` (changed: the combinations
  `e2e-subs`, `e2e-dev-subs` and `full-subs` with their published ports, rule 5 at
  `check-setup.sh:74-91`)
- `.github/workflows/ci.yml` (changed: a `lint` step `bash e2e/subscriptions.test.sh` after
  `:55`; in `e2e-dev`, `grep -qx 'ok: email subscriptions' e2e-dev.log` after `:306`)
- `README.md` (changed: secrets model, port table, e2e test)
- `full/README.md` (changed: how to turn subscriptions on with `full/subscriptions.example.yaml`;
  the SMTP password file; root hosting; the contact; deletion requests and backups)

Behavior change: yes. New secrets handling, a new CI requirement and test scenario.

Behavior:
- `secrets-init.mjs`, files mode, with `PULSE_SECRETS_SUBSCRIPTIONS`:
  - unset or `off`: nothing new;
  - `on`: read `/in/subscriptions-token` and `/in/subscriptions-key` with `readHostFile`; each must
    be 64 lowercase hex after one trailing newline is dropped, and the two must differ from each
    other and from every token and key read in this run, else fail with `<file>: <rule>` (the
    pattern of `secrets-init.mjs:31-34`). `/out/status` and `/out/notify` must be directories, else
    fail `/out/status: is not mounted`. All inputs are checked before the first write. Then write
    `/out/status/subscriptions-token`, `/out/notify/subscriptions-token` and
    `/out/notify/subscriptions-key` with `writeSecret` (`0400`, `1000:1000`);
  - `on`, the optional SMTP password `/in/subscriptions-smtp-password` (D14). `lstat` first:
    - missing (`ENOENT`): no password is written, and after every other write of the run
      `/out/notify/subscriptions-smtp-password` is removed if an earlier run left one (so
      deleting the host file removes the copy at the next `up`). Any other `lstat` error fails
      `/in/subscriptions-smtp-password: cannot be read`;
    - present: read with `readHostFile` (`secrets-init.mjs:42-56`: a symlink, a non-regular file
      and a mode with group or other bits fail with its existing rule lines). Then one trailing
      newline is dropped, and the value must be 1..512 characters with no CR, LF or NUL and no
      leading or trailing space or tab, else fail `/in/subscriptions-smtp-password: must be one
      line of 1 to 512 characters without leading or trailing spaces` (notify's `readSecretFile`
      trims, `kit/src/secret-file.ts:35`, the same at the pin `236df214`, so a padded value
      would not be the password the operator meant). It must differ from every token and key
      of the run, else fail `/in/subscriptions-smtp-password: must differ from every token and
      key`. It is checked with
      the other inputs before the first write, and written as
      `/out/notify/subscriptions-smtp-password` with `writeSecret` (`0400`, `1000:1000`): the
      value and one newline;
    - no message names the value or a part of it;
  - `off` or unset: `/in/subscriptions-smtp-password` is neither read nor written, also when it
    exists;
  - any other value: fail `PULSE_SECRETS_SUBSCRIPTIONS: must be on or off`;
  - generate mode with `on`: fail `PULSE_SECRETS_SUBSCRIPTIONS: files mode only`.
- `e2e/compose.subscriptions.yaml` (merged after the base file and `e2e/compose.e2e.yaml`, test
  only, comment header like `e2e/compose.e2e.yaml:1-5`):
  - `secrets-init`: `PULSE_SECRETS_SUBSCRIPTIONS: "on"` and the volumes
    `status-secrets:/out/status`, `notify-secrets:/out/notify`. The e2e secrets directory has no
    `subscriptions-smtp-password` and notify has no login settings (mailpit takes mail without
    login), so the scenario runs the "absent" path of the password;
  - `mailpit`: `extends: { file: ../common/services.yaml, service: mailpit }`, port
    `127.0.0.1:${PULSE_MAILPIT_PORT:-8025}:8025`, no other change;
  - `status`: `PULSE_STATUS_SUBSCRIPTIONS_URL: http://notify:9300`,
    `PULSE_STATUS_SUBSCRIPTIONS_TOKEN_FILE: /run/pulse/subscriptions-token`,
    `PULSE_STATUS_SUBSCRIPTIONS_CONTACT: privacy@e2e.invalid`, volume
    `status-secrets:/run/pulse:ro`, `depends_on` `secrets-init` completed and `notify` started;
    `PULSE_STATUS_PUBLIC_URL` stays `http://status.e2e.invalid` from `e2e/compose.e2e.yaml:26`
    (a root origin, R9);
  - `notify`: `PULSE_NOTIFY_SUBSCRIPTIONS: "on"`,
    `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL: http://status.e2e.invalid` (the value that
    `e2e/compose.e2e.yaml` gives `PULSE_STATUS_PUBLIC_URL`),
    `PULSE_NOTIFY_SUBSCRIPTIONS_FROM: pulse e2e <status@e2e.invalid>`,
    `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_HOST: mailpit`, `..._SMTP_PORT: "1025"`,
    `..._SMTP_TLS: none`, `..._TOKEN_FILE: /run/pulse/subscriptions-token`,
    `..._KEY_FILE: /run/pulse/subscriptions-key`, `..._STATE: /data/notify-subscriptions.db`,
    `PULSE_NOTIFY_RETRY_DELAY_MS: "500"`, `PULSE_NOTIFY_SUBSCRIPTIONS_MAX: "5"` (so the scenario
    can reach L1 with six addresses) and `PULSE_NOTIFY_SUBSCRIPTIONS_MAX_PENDING: "5"` (R3
    requires `MAX_PENDING <= MAX`; the default `1000` would make notify exit `2`. With both at
    `5`, L2 can only be full when L1 is full too, and R5 reports L1 first, so the scenario's
    limit is always `capacity`; the most pending rows it holds is 3, B, D and E after step 5a),
    volume `notify-secrets:/run/pulse:ro`, `depends_on`
    `secrets-init` completed and `mailpit` started;
  - top-level volumes `status-secrets`, `notify-secrets`.
- `full/subscriptions.example.yaml` (comment header: copy to `full/compose.override.yaml`, edit
  the lines marked `edit`, start with `docker compose -f full/compose.yaml -f
  full/compose.override.yaml up -d`; for a server without login, delete the two lines marked
  `login` and do not create the password file). It sets the keys of the e2e overlay for `full`,
  with these differences: no mailpit; `PULSE_STATUS_PUBLIC_URL` (status) and
  `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL` (notify) are both
  `${PULSE_STATUS_PUBLIC_URL:?set PULSE_STATUS_PUBLIC_URL in full/.env}`, so the two cannot
  differ; `PULSE_STATUS_SUBSCRIPTIONS_CONTACT: privacy@example.com`,
  `PULSE_NOTIFY_SUBSCRIPTIONS_FROM: pulse <status@example.com>`,
  `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_HOST: smtp.example.com`, `..._SMTP_PORT: "587"` and
  `..._SMTP_TLS: starttls` (each marked `edit`); the `login` lines
  `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_USERNAME: status@example.com` (also `edit`) and
  `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE: /run/pulse/subscriptions-smtp-password`;
  `secrets-init` with `PULSE_SECRETS_SUBSCRIPTIONS: "on"` and the volumes
  `status-secrets:/out/status`, `notify-secrets:/out/notify`; status and notify mount their
  secrets volume at `/run/pulse` read-only and depend on `secrets-init` completed; top-level
  volumes `status-secrets` and `notify-secrets`; no port, no `image:` line, no literal secret.
  With the `login` lines set and no host password file, `secrets-init` writes no password and
  notify exits `2` naming `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE` (R3): a missing password
  never becomes a silent send without login.
- `full/README.md` documents that file: a real SMTP server with TLS `starttls` or `tls`; the
  password goes into `secrets/subscriptions-smtp-password`, written by the operator with mode
  `0600` (for example `(umask 077; cat > secrets/subscriptions-smtp-password)` with the password
  on standard input, so it is not in the shell history), never into the override or `.env`;
  `scripts/init-secrets.sh` creates the token and the key but never the password; deleting the
  file and the `login` lines turns login off at the next `up`; and the one `.env` variable
  `PULSE_STATUS_PUBLIC_URL`. It states the root rule of R9 with the sentence of R9, the contact
  setting `PULSE_STATUS_SUBSCRIPTIONS_CONTACT`, the operator duties of R10 (answer the contact;
  delete on request with `docker compose -f full/compose.yaml -f full/compose.override.yaml stop
  notify`, then `docker compose -f full/compose.yaml -f full/compose.override.yaml run --rm
  --no-deps notify bun --no-env-file src/index.ts subscribers delete <address>`, then `start
  notify` with the same two files; keep backups of the notify volume for a stated time, D-R7,
  D-R11), and that the console does not show subscribers.
- The step "Email subscriptions" in `e2e/compose-e2e.sh`:
  - `E2E_SETUP=full`: prints `skip: email subscriptions (published images)`;
  - `dev`: runs `bash e2e/subscriptions.sh "$api_port" "$status_port"` with the admin token in
    the environment, prints its output, fails when it fails, and the last line is
    `ok: email subscriptions`.
- `e2e/subscriptions.sh` (uses `COMPOSE_FILE=<base>:e2e/compose.e2e.yaml:e2e/compose.subscriptions.yaml`
  for its own calls only; addresses `sub-a@e2e.invalid` … `sub-f@e2e.invalid` (A-F) and marker
  strings are literals in the script; steps 3 to 5b run within seconds, far below the 10-minute
  cooldown L3, and the script fails if they take longer than 300 s):
  1. `up -d mailpit`, wait for `GET /api/v1/messages` `200`, `DELETE /api/v1/messages`. Then
     `up -d --force-recreate secrets-init status notify` and wait until both are healthy and
     notify's `pulse_notify_polls_total{outcome="ok"}` grew.
  2. `GET /` holds `id="subscribe"`, `action="/subscribe"` and `name="email"`; its CSP holds
     `form-action 'self'`. It holds `id="subscribe-notice"`, the literal sentences `If you do not
     confirm, we delete all of it within 25 hours of the last confirmation email.`, `After you
     confirm, we keep it until you unsubscribe.`, `Every email has an unsubscribe link. It deletes
     your address and these records at once, also from emails that are waiting to be sent.`,
     `One email that is being sent at that moment can still arrive.`, and
     `<a href="mailto:privacy@e2e.invalid">privacy@e2e.invalid</a>` (all literals in the script,
     from R10 and the overlay's contact).
  3. `POST /subscribe` for A (sent as `Sub-A@E2E.invalid`), B and C (form bodies) → `200` each.
     Wait (bounded, `T_NOTIFY`) until mailpit has exactly one message to each of A, B, C whose
     subject ends with `Confirm your subscription`, whose `To` has one address, and whose text
     holds `http://status.e2e.invalid/subscribe/confirm?token=` and
     `http://status.e2e.invalid/unsubscribe?token=`.
  **Barriers.** A mail that is expected proves nothing about a mail that must not come: fan-out
  sends in `id` order, and the ids are random, so C's message can arrive before or after a
  wrong send to A; and a later incident can be detected in the same poll as an earlier one. So
  no step uses "another recipient's mail arrived" or "a later incident's mail arrived" as proof
  of absence. Every incident step instead ends with `settle`, a shell function of
  `e2e/subscriptions.sh` that reads notify's metrics the way `notify_polls_ok` does
  (`e2e/compose-e2e.sh:635-640`, a `fetch` of `http://127.0.0.1:9100/metrics` inside the notify
  container):
  - S1 Right after the step's last api write answered its success code, read
    `d0 = pulse_notify_subscriber_detections_total`.
  - S2 Wait (bounded, `T_NOTIFY`) until that counter is at least `d0 + 2`. The poll that makes it
    `d0 + 2` fetched the feed after the write and committed its detection (R5 "Detection").
  - S3 Wait (bounded) until `pulse_notify_subscriber_events_pending` is `0`: every event of the
    step has finished its last pass, so no send is in flight or due.
  - S4 Compare `pulse_notify_subscriber_mails_total{kind="incident",outcome="success"}` with its
    value before the step: the difference must equal the step's literal `sent` number, and the
    `outcome="failure"` series must not have grown. A send to an address that must not get mail
    makes this difference too big, whatever the order of the sends.
  - S5 Wait (bounded) until mailpit holds the step's expected messages; then read the step's
    negative counts. Then wait for one more detection (`d >= current + 1`) and
    `events_pending 0` again, and read the negative counts a second time; both reads must give
    the literal `0` (or the literal count).
  The `docker compose restart notify` of step 11 runs only after step 10's `settle` passed, so
  the restart cannot cancel a wrong send that was still due. After the restart the counters
  start at `0` again; the script reads its "before" values after the restart.
  4. Repeat `POST /subscribe` for A → `200`. Notify decides "no mail" (R5 subscribe step 3)
     before it answers, so no job for A exists. Then subscribe a fourth address D and wait for
     D's confirmation, then until `pulse_notify_subscriber_confirmations_queued` is `0` (every
     job queued before is handled or dropped; no job of this scenario waits for a retry or a
     busy mailbox unless a send failed, which the failure counter would show). A still has
     exactly 1 message, and
     `pulse_notify_subscriber_mails_total{kind="confirmation",outcome="success"}` is exactly `4`.
  5. For A and C: take the path and query of the confirm link, `GET` it on
     `127.0.0.1:<status port>` → `200` with a form; `POST /subscribe/confirm` with that token →
     `200`. B and D stay pending. The store now has 4 rows; `PULSE_NOTIFY_SUBSCRIPTIONS_MAX` is 5.
  5a. **Below capacity, known versus unknown** (R8). Send `POST /subscribe` for A (confirmed), D
     (pending, in cooldown) and E (unknown), in that order, each with the same request headers,
     including `Host: evil.example`, `X-Forwarded-Host: evil.example` and
     `X-Forwarded-Proto: https`. Save each answer's status, headers and body with `curl -sS -D`,
     and its `%{time_starttransfer}` with `curl -w`. Each of the three times is at least `2.000`
     seconds (the literal `SUBSCRIBE_RELEASE_MS` of R2, D22; a lower bound only, as a positive
     control that the release runs in the built image; the times are not compared with each
     other, because the timing class is checked with injected schedulers in the status and notify
     tests, not with a wall clock). The three status codes are `200`; the three bodies are byte-equal (`cmp`); the three header
     lists without the `date` line are byte-equal; no answer has `location`, `retry-after`,
     `set-cookie` or `etag`. No answer (headers or body, compared without case) holds any of the
     six visitor addresses `sub-a@e2e.invalid` … `sub-f@e2e.invalid`, any of their local parts
     `sub-a` … `sub-f`, or `evil.example` (literals in the script). The contact
     `privacy@e2e.invalid` of the overlay is the one `@e2e.invalid` address the answer must hold
     (R2 subscribe answer, R10): each body holds
     `<a href="mailto:privacy@e2e.invalid">privacy@e2e.invalid</a>` (positive control), and after
     every occurrence of that literal is removed, no body holds `@e2e.invalid`. Then wait
     until `pulse_notify_subscriber_confirmations_queued` is `0`: the confirmation success
     counter is exactly `5`; `pulse_notify_subscription_requests_total{route="subscribe",
     outcome="known"}` grew by exactly `2` and `outcome="queued"` by exactly `1` (positive
     controls that the store saw both kinds). E has exactly 1 message; every link in it starts
     with `http://status.e2e.invalid/` and no part of it holds `evil.example` (R9). A and D still
     have exactly 1 message each. The store now has 5 rows (full).
  5b. **At capacity, known versus unknown** (R8). Send `POST /subscribe` for F (unknown), A
     (confirmed), F again, and D (pending), with the headers of 5a. All four answers are compared
     as in 5a with each other and with the saved E answer of 5a: all byte-equal (except `date`),
     and each passes the address checks of 5a (no visitor address or local part, no
     `evil.example`, the contact link present, and no other `@e2e.invalid`), and each
     `time_starttransfer` is at least `2.000` seconds, at capacity as below it.
     Wait until `pulse_notify_subscriber_confirmations_queued` is `0`; the confirmation success
     counter is still exactly `5`; `pulse_notify_subscription_limited_total{limit="capacity"}` is
     exactly `2` (the positive control that L1 was reached, for F twice). Read F's message count
     (`0`), wait for one more `pulse_notify_subscriber_detections_total` step, and read it again
     (`0`). A and D still have exactly 1 message each.
  6. Publish public manual incident P1 (`POST /manual-incidents`, title `e2e-sub-p1-5d2`), add
     an update with message `e2e-sub-p1-upd-5d2`, resolve it. `settle` with `sent = 6` (3 events
     × A and C). A and C each have the three incident messages (subjects
     `New incident: e2e-sub-p1-5d2`, `Update: …`, `Resolved: …`), each with one `To` address and
     a text that holds `/unsubscribe?token=`. A's messages do not contain C's address and the
     other way round. Negative counts: B, D and E have exactly 1 message (the confirmation), F
     has 0.
  7. Private activity on the api's admin routes (as in `e2e/compose-e2e.sh:715-745`): draft D2
     with marker `e2e-sub-draft-9a7`, internal incident I2 with `e2e-sub-internal-9a7` published,
     public incident P2 (title `e2e-sub-p2-9a7`, its opened mail is expected) with a note
     `e2e-sub-note-9a7` and a saved draft update `e2e-sub-dupd-9a7`. Each write must answer its
     success code (positive control). `settle` with `sent = 2` (P2 opened × A and C). Negative
     counts: a mailpit search for each of the four private markers returns 0 messages.
  8. Publish P2's draft update, publish D2, and resolve I2 through its draft and publish (as at
     `:835-836`). `settle` with `sent = 4` (P2 update and D2 opened × A and C). A and C each have
     exactly one message holding `e2e-sub-dupd-9a7` and one `New incident` message of D2.
     Negative count: `e2e-sub-internal-9a7` has 0 messages.
  9. A: take the unsubscribe link of A's last message; `GET` → `200` with a form; `POST
     /unsubscribe` → `200`; again → `200`. B: unsubscribe through its confirmation mail → `200`;
     then `POST /subscribe/confirm` with B's old confirm token → `400`. Notify answers `200` only
     after the delete committed (R5), so no barrier is needed here.
  10. Publish P4 `e2e-sub-p4-9a7`. `settle` with `sent = 1` (C only). C has 1 message with
      `e2e-sub-p4-9a7`. Negative counts: A, B, D, E and F have 0 messages with
      `e2e-sub-p4-9a7`.
  11. `docker compose restart notify`; wait until healthy and
      `pulse_notify_subscriber_detections_total` is at least `2`, then
      `pulse_notify_subscriber_events_pending` is `0` and
      `pulse_notify_subscriber_mails_total{kind="incident",outcome="success"}` is `0` (nothing
      resent). Publish P5 `e2e-sub-p5-9a7`; `settle` with `sent = 1`. C has exactly 1 message
      with `e2e-sub-p4-9a7` and 1 with `e2e-sub-p5-9a7`. Negative counts: A, B, D, E and F have 0
      messages with either marker.
  11a. **Operator deletion** (D18, R10). `docker compose stop notify`; `docker compose run --rm
      --no-deps notify bun --no-env-file src/index.ts subscribers delete Sub-C@E2E.invalid`
      prints exactly `deleted 1` and exits `0`; the same command again prints exactly `deleted 0`
      and exits `0`; neither output holds `sub-c`. `docker compose start notify`; wait as in step
      11 (healthy, detections at least `2`, events pending `0`, incident success `0`). Publish P6
      `e2e-sub-p6-9a7`; `settle` with `sent = 0`. Negative counts: no address has a message with
      `e2e-sub-p6-9a7` (both reads `0`). C's earlier messages stay in mailpit (Pulse cannot
      remove sent mail, R10).
  12. Hostile requests: `POST /subscribe` with `email=a%40e2e.invalid%0D%0ABcc%3Ax%40e2e.invalid`
      → `400`; with `Origin: https://evil.example` → `403`; from inside the status container,
      `POST http://notify:9300/subscriptions` without a token → `401`.
  12a. **Prefixed deployment is refused** (R9). `docker compose run --rm --no-deps -e
      PULSE_STATUS_PUBLIC_URL=http://status.e2e.invalid/pulse status` exits `2` and its output
      holds `PULSE_STATUS_PUBLIC_URL: must be an origin without a path when subscriptions are on
      (root hosting)`; the same with `http://status.e2e.invalid/pulse/`. `docker compose run --rm
      --no-deps -e PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL=http://status.e2e.invalid/pulse notify`
      exits `2` and its output holds `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL: must be an origin
      without a path (root hosting)` (the running notify holds the store lock, so a wrong
      implementation that opens the store first fails with the lock message instead). Afterwards
      the running status and notify are still healthy. The root deployment is the whole scenario
      above (steps 1-11a).
  13. `docker compose logs status notify` holds none of the six addresses (in any case), none of
      the tokens taken from mail, and neither secret file's content.
  14. Resolve the open e2e incidents, recreate status and notify with the regular two files
      (`up -d --no-deps --force-recreate status notify`), stop and remove mailpit, and print
      `ok: email subscriptions`.
  Each `ok:` line names its literal expectation. Waits are bounded by the script's `T_*` timeouts;
  every negative mail check of an incident step runs only after that step's `settle` (S1-S5)
  passed, never after another recipient's or a later incident's mail alone. A `settle` that
  times out fails the scenario with the metric values it read (no address or token in them).
- `README.md`: the two new secrets, the optional `subscriptions-smtp-password` (written by the
  operator, copied only with the switch on, removed from the volume when the host file is gone),
  the `PULSE_SECRETS_SUBSCRIPTIONS` switch, the mailpit port of the subscription overlay in the
  port table, and the new scenario.
- `scripts/check-setup.sh`: `compose_args` gets `e2e-subs` (`-f full/compose.yaml -f
  e2e/compose.e2e.yaml -f e2e/compose.subscriptions.yaml`) and `e2e-dev-subs` (the same with
  `dev/compose.yaml`). `expected_ports` for both is the `e2e` list plus
  `mailpit 127.0.0.1 8025 8025`, written literally. `full-subs` is `-f full/compose.yaml -f
  full/subscriptions.example.yaml`, resolved with
  `PULSE_STATUS_PUBLIC_URL=https://status.example.com` set for that call only; its
  `expected_ports` is the `full` list, written literally (the override publishes nothing). The
  loop of `:92` runs over all three, so rule 8 (only a `*-secrets` volume at `/run/pulse`) covers
  the new status and notify mounts, also the password file's.
  `check-setup.test.sh` gets one broken copy of the overlay with mailpit on `0.0.0.0` and expects
  the rule 5 failure.

Checks:
- `bash scripts/secrets-init.test.sh` (Docker): `on` with valid inputs writes the three files
  `0400` `1000:1000`; a missing input, a 63-character value, an upper-case value, equal values, a
  value equal to the probe token, a missing `/out/status` each fail with the literal rule line and
  write nothing; no output holds a value; `off` writes none of the files.
- The SMTP password in the same script (`run_init` gets `/out/status` and `/out/notify` for these
  cases; the password literal `pw-e2e-Secret 42!` has an inner space, which is allowed):
  - present, mode `0600` → `/out/notify/subscriptions-smtp-password` exists with mode `0400`,
    owner `1000:1000` and the content `pw-e2e-Secret 42!` and one newline (`stat -c '%a %u:%g'`
    prints `400 1000:1000`; the bytes are compared with `cmp` against a file the test writes
    itself);
  - absent → no such file; then absent after a run that wrote it (same output volume) → the file is
    gone, and the token and key files are still there;
  - mode `0640`, mode `0604`, a symlink, a directory, an empty file, only a newline, two lines,
    a CR inside, a leading space, a trailing tab, 513 characters, and a value equal to the
    subscriptions token → each fails with exit `1` and its literal rule line (the lines of
    `readHostFile` for mode, symlink and non-regular file; the two new lines above for the rest),
    and writes none of the subscription files (also not the token and key);
  - 512 characters → accepted;
  - `PULSE_SECRETS_SUBSCRIPTIONS=off` with a present password file (also one with mode `0644`) →
    succeeds, and no subscription file is written;
  - every case's stdout and stderr hold neither the password literal nor its part `Secret 42`
    (the secret check of `expect_refused`, `secrets-init.test.sh:62-74`, run for both strings),
    and a passing run prints only `secrets-init: files mode done`.
- `e2e/subscriptions.test.sh` runs `docker compose -f full/compose.yaml -f
  full/subscriptions.example.yaml config --format json` with
  `PULSE_STATUS_PUBLIC_URL=https://status.example.com` and checks with `jq`: notify's
  `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE` is `/run/pulse/subscriptions-smtp-password`;
  notify mounts `pulse_notify-secrets` (a volume) at `/run/pulse` read-only; secrets-init has
  `PULSE_SECRETS_SUBSCRIPTIONS` `on` and the `/out/notify` volume; status's
  `PULSE_STATUS_PUBLIC_URL` and notify's `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL` are both
  `https://status.example.com`. Without `PULSE_STATUS_PUBLIC_URL` the same `config` fails and
  its error holds `set PULSE_STATUS_PUBLIC_URL in full/.env` (literals in the test).
- The secret check of the same `config` output (`full` override). The required file path
  `/run/pulse/subscriptions-smtp-password` is a path, not a secret, and is allowed; the check
  looks for secret content instead of the word `password`:
  - the test runs `config` with `PULSE_SECRETS_DIR` set to a `mktemp -d` directory that holds
    `subscriptions-smtp-password` with the literal `pw-config-Secret 7` (mode `0600`) and the
    token and key files of `scripts/init-secrets.sh`; the whole JSON output holds neither
    `pw-config-Secret 7` nor its part `Secret 7`, nor the content of any of those token and key
    files (read by the test from the files it wrote);
  - no environment value of any service matches `^[0-9a-f]{64}$` (the token and key format);
  - no environment key of any service ends in `PASSWORD`, `TOKEN`, `KEY` or `SECRET` (a secret
    passed by value); every key that contains one of those words and ends in `_FILE` has a value
    that starts with `/run/pulse/` (today's keys of `common/services.yaml:13,22` and
    `full/compose.yaml:34,85-86` meet it; `PULSE_CHECKS_FILE` at `full/compose.yaml:35` holds none
    of the words and is not checked);
  - the only environment value that contains `password` (ignoring case) is the value of notify's
    `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE`, and it is exactly
    `/run/pulse/subscriptions-smtp-password`.
  The test also runs the `jq` filter of these rules on fixed JSON (literals in the test): it
  passes for a notify environment that holds only
  `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE: /run/pulse/subscriptions-smtp-password`; it
  fails for an extra key `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD: hunter2`, for that `_FILE` key
  with the value `/tmp/subscriptions-smtp-password`, for a value of 64 `a` characters, and for a
  value `password=hunter2` under another key.
- `bash scripts/init-secrets.test.sh`, `bash e2e/subscriptions.test.sh`,
  `scripts/check-setup.sh`, `bash scripts/check-setup.test.sh`.
- `e2e/subscriptions.test.sh` also drives `settle` with a fake metrics reader that replays fixed
  metric texts (literals in the test): it fails when the detections counter grows by only 1
  after the write, when `events_pending` stays `1`, when the incident success difference is
  `2` for an expected `1`, and when the failure series grew; it passes for a replay that meets
  S2-S4 and whose second negative read is still `0`.
- `e2e/subscriptions.test.sh` drives the answer comparison of steps 5a and 5b with fixed `curl
  -D` header and body files (literals in the test): it passes when only the `date` line differs;
  it fails when one answer has an extra `retry-after: 60` line, when the status lines are `200`
  and `429`, when the bodies differ by one byte, when a body holds `sub-u@e2e.invalid`, when a
  body holds `SUB-C@E2E.INVALID` (case), when a body lacks the contact link, and when a body
  holds the contact link and also `other@e2e.invalid`. It passes for equal bodies that hold
  `<a href="mailto:privacy@e2e.invalid">privacy@e2e.invalid</a>` and no other address. The
  release lower bound of the same helper fails for a time of `1.999` and passes for `2.000` and
  `2.350` (literals in the test).
- `e2e/subscriptions.test.sh` checks the notice matcher of step 2 against a fixed page text: it
  fails when `25 hours` is replaced by `24 hours` in the deletion sentence, when the sentence
  `One email that is being sent at that moment can still arrive.` is missing, and when the
  contact link is missing.
- Shell lint, helper syntax and JSON syntax of the `lint` job (`ci.yml:34-40`, commands in
  `deploy/AGENTS.md`, "Commands"), run from the repository root.
- `E2E_SETUP=dev bash e2e/compose-e2e.sh` with sibling checkouts of the merged status and notify
  `main` that contain the feature; the PR names the five service SHAs (the CI step
  "Revisions of the service checkouts", `ci.yml` in the `e2e-dev` job) and pastes the
  `ok: email subscriptions` line.
- `bash e2e/compose-e2e.sh` (full) still passes and prints the skip line.
- `bun run check` (`package.json:18`) stays green; the CLI is not changed. CI `ci.yml:17` uses
  `check.yml@04108fa…` (equal to the clone). Biome does not check `scripts`, `e2e` or `full`
  (`biome.json:12-20`).

Completion evidence: the logs of the dev and full e2e runs with the service SHAs; the outputs of
the listed test scripts.

## Acceptance evidence (feature)

The feature is done when all of these hold. Every expected value is a literal in the check.

1. Notify tests (notify section): an unconfirmed address gets 0 incident sends while a confirmed
   one gets 3; after unsubscribe 0 sends; a draft, a draft update, a note and an internal incident
   give 0 sends, and publishing the draft gives 1 per confirmed address; with
   `PULSE_NOTIFY_RETRY_ATTEMPTS = 3`, an always failing address gets exactly 3 send attempts
   across restarts, also when a restart falls inside the last allowed pass.
2. Status tests: every status counterexample with its literal status code and notify call count.
3. Contract tests: every address-rule row with its literal result, and the two time constants.
4. The `e2e-dev` CI run of deploy after the deploy PR shows the line `ok: email subscriptions`, with
   mail read from mailpit; the line `ok: manual incident privacy` and every other existing `ok:`
   line still appear.
5. Every child's `bun run check` (and deploy's listed scripts) passes, and no budget of
   `api/bench/budgets.json` is exceeded.
6. **No enumeration (manager requirement 1).** Notify and status enumeration tests: for every row
   of "No enumeration (R8)" the answers for a known and an unknown address are byte-equal (except
   `date`), in both orders, and the store and mail counts match the literal "Must also hold"
   column. In the integrated scenario, steps 5a (below capacity, 4 of 5 rows) and 5b (at
   capacity, 5 of 5 rows, `limited_total{limit="capacity"} = 2`) compare real status answers
   for confirmed, pending and unknown addresses byte for byte, and F gets no mail.
7. **Root hosting (manager requirement 2).** Status and notify settings tests give the literal
   results of "Root hosting (R9)"; e2e step 12a shows both services refusing a `/pulse` prefix
   with their literal lines (the prefixed deployment), and steps 1-11a run the whole flow on the
   root origin `http://status.e2e.invalid` (the root deployment), with every mail link under that
   origin also when the request carries forged `Host` and `X-Forwarded-Host` headers (step 5a).
   The READMEs hold the R9 sentence.
8. **Visitor information (manager requirement 3).** Status tests and e2e step 2 find each literal
   sentence of the R10 notice and the configured contact link on the form; startup without a
   contact fails naming `PULSE_STATUS_SUBSCRIPTIONS_CONTACT`; notify's cleanup test deletes an
   unconfirmed row by the literal 25-hour bound that the notice states; e2e step 11a deletes an
   address through the documented operator command, and no later incident mail reaches it;
   notify's "Confirmation queue (D19)" tests remove the queued jobs of an unsubscribed or expired
   row while the fake keeps another send blocked (gauge literals `2` and `1`, and no send to the
   deleted address afterwards), so "at once" and "within 25 hours" in the notice hold for the
   queue too, with the in-flight email that the notice names as the only exception; notify's
   "One send per mailbox (D20)" tests hold an attempt of either worker unresolved across
   confirm, detection, unsubscribe and re-subscribe, and show at most `1` attempt in flight for
   the address as the fake mailer sees it (item 10), so the notice's "One email" is the true
   bound; notify's "Late completion
   after delete (D21)" tests hold an incident send across an unsubscribe and settle it with
   success, a permanent failure, a temporary failure and a timeout, and each shows `0`
   subscription rows and `0` delivery rows for the deleted id, `0` sleeps and no second send, and
   the event `done` with `passes = 1`, so "It deletes your address and these records at once"
   holds also for a send that ends after the delete.
9. **SMTP password through `secrets-init`.** Deploy's `secrets-init.test.sh` writes the password
   `0400` `1000:1000` with the literal content, refuses each bad input with its literal rule line
   and writes nothing then, removes a stale copy when the host file is gone, ignores the file
   with `off`, and never prints the password; `e2e/subscriptions.test.sh` shows that the `full`
   override points notify at `/run/pulse/subscriptions-smtp-password` on its secrets volume and
   that the `config` output holds neither the literal `pw-config-Secret 7` from the secrets
   directory nor any other secret content (the file path is the one allowed value with
   `password`); the notify settings tests give the literal results for the username and password rules.

10. **One send per mailbox (manager requirement 4).** `test/subscriptions-mailbox.test.ts` runs
    the deterministic sequences of "One send per mailbox (D20)": subscribe, unsubscribe and
    re-subscribe of `sub-m@example.com` (the re-subscribe from the normalized form of
    `" SUB-M@Example.COM "`) with both workers, one with the old confirmation attempt held and
    one with the old incident send held. The fake mailer's largest number of calls in flight for
    `sub-m@example.com` is the literal `1` in every case and subcase (success, 550, temporary
    failure, timeout, stop); the new row's confirmation call starts after the old attempt
    settled; another mailbox (`sub-n@example.com`) gets its confirmation call while M waits; the
    guard's `size()` is `0` after every case; and the owner check ignores a late release. The
    file's self-check with a row-keyed guard reaches `2`, so the check can fail. While M's
    mailbox is held and M2 waits with an elapsed `notBefore`, worker 1 calls no sleep (record
    `[]`) and runs no further selection step (growth `0`); a retry of N then sleeps only for
    future time (`[1000, 542]`, every value at least `1`), and M2 starts when M's entry settles.
11. **Response timing (manager requirement 5).** `src/subscribe-timing.test.ts` (status) shows,
    with a manual scheduler, that K, P and U requests, in both orders, below every limit, at L0
    and one below L9, each register exactly the timers `[5000, 2000, 1500]` (body deadline,
    release, the call's own timeout; `[5000, 2000]` when L0 skips the call; registrations,
    cancelled ones included), never have more than `2` live timers, with the release
    timer before the notify call, and receive `0` bytes before the `2000` timer fires, also when
    the `1500` timer fired, whatever the fake notify does per address (fast `202`, error, `302`,
    bad body, closed socket, no answer); refusals before the address register `0` timers
    (`403`, `415`, L9 full) or only the cancelled body deadline `[5000]` (`413`, `400`).
    `test/subscriptions-enumeration.test.ts` (notify) shows that K, P and U, below
    every limit and at L1, L2, L5 and L6, in both orders, are answered with `0` timers and an
    unmoved manual clock while every SMTP send and the fan-out are held. Deploy steps 5a and 5b
    see each real answer after at least `2.000` s.
12. **Notify file list (manager requirement 6).** The notify `Files:` list names every file of the
    notify tasks, including `test/index.test.ts` and `test/metrics.test.ts`, and every notify check
    names its file from that list; the breakdown's mechanical path check compares the task paths
    with this list in both directions.
13. **Admission cap under slow bodies (L9).** `src/subscribe-routes.test.ts` (status), block
    "Admission (L9), partial bodies": 257 requests whose bodies are still open give exactly `256`
    admitted and `1` busy `503` with the release timers frozen; each of the eight paths (`400`
    address, `413`, `400` fields, disconnect during the body, disconnect while waiting, body
    deadline, release, `415`) frees exactly one slot (the probe admits `1` and refuses the next);
    after all requests closed, `256` are admitted again. The self-check with a check-before-body,
    count-after-body admission reaches `257`, so the check can fail.

Issue review checks (third review, 1-14) map to: 1 → items 3 and 5 and the notify settings
checks; 2 → item 4 (steps 3-6) and item 1; 3 → item 4 (steps 6-8) and the notify "Eligibility and
privacy"; 4 → items 1 and 4 (steps 9, 11a) and the notify "Cleanup boundaries"; 5 → item 6; 6 →
item 11; 7 → item 7; 8 → item 8; 9 → item 8 (the D19 block); 10 → item 10; 11 → item 8 (the D21
block); 12 → item 1 and the notify "Fan-out failures"; 13 → items 4 and 9 and the deploy "Barriers"
and its `subscriptions.test.sh`; 14 → items 5, 7 and 12 and the security checklist.
