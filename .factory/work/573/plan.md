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
  setting. R8, R9 and R10 implement them; D15-D18 record the choices.
- The first spec of this feature (closed PR #814, head `55f1da0d`) passed `spec/plan-review`
  before the manager added these requirements. This spec is that version, revised. Its two
  rules that broke the new requirements are changed: notify no longer answers `429` to an
  unknown address while a known one gets `202` (row cap and global window, old R5 steps 4 and 6),
  and status no longer maps notify's answer to different public pages (old R2 table). The meta
  change of PR #814 to `docs/approved-packages.md` (mailpit in the e2e overlay) is made again in
  this spec PR.
- The issue review (`.factory/work/573/issue-review.md`, the second one, written for the added
  requirements). It has no blocking question and lists open points 1-6 and derived checks 1-9.
  Decisions D1-D18 below settle the open points; "Acceptance evidence" maps the checks.
- #460, section 12 (as quoted in the issue review): subscriber mail belongs to pulse-notify with
  its own settings, never to the console. This spec follows it. The console does not change.
- #568 (closed, complete): drafts, notes and internal incidents. Its public projection is on
  `main` and is reused here, not rebuilt: the api serves only published public incidents with
  their published updates, and notify filters private items before validation
  (`notify/src/api.ts:301-308`, `isPublicManualIncident` and `publicManualIncident` of the
  contract, `contract/src/manual-incident-public.ts`).
- #570 (in flight). Its contract child #806 is merged (contract `2.4.0`); #807-#811 (api,
  console, status, notify, deploy) are open, and #815 (contract `2.4.1`, a patch) is open. #570
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
- Shared findings: `gh api repos/lorenzh/pulse-meta/git/ref/heads/factory/findings/573` is
  answered `HTTP 404` in this run. So there are no findings yet, which is normal for a feature
  without children.

### Clone heads read for this spec

Status, notify, deploy, api, kit and config have the same HEAD as for PR #814, so the line
references below were read at these SHAs. Contract moved from `ebf6bbc` (`2.3.0`) to `c5ce668`
(`2.4.0`, the merge of #806); its references are read again at the new HEAD.

| Target | HEAD | What matters here |
| --- | --- | --- |
| contract | `c5ce6685ce8b563a243823bca451032291b81adb` | version `2.4.0` (`package.json:3`); `WIRE_VERSION = 1` (`src/version.ts:5`); `ErrorResponse` at `src/schema.ts:1298` |
| status | `8b6d4315fcb989a7a8d74c063ab08d97c18a7d2d` | pins contract `9ab7e249…` (version `2.1.0`, `package.json:34`) |
| notify | `c79f0b7cb5e25ada96e6314220e69cf4f5279b32` | pins contract `9ab7e249…` (`package.json:30`), ledger format 4 (`src/ledger.ts:31`) |
| deploy | `e754d468a2c445e76d5017692096428bff179f28` | e2e on `full` or `dev`; mailpit pinned in `common/services.yaml` for the demo |
| api | `3b29fa0ce29890248ade4294a55812cc77ed951c` | read only; not changed |
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
  (`deploy/scripts/secrets-init.mjs:1-14`). CI job `e2e-dev` requires two `ok:` lines
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
  the start of the send. A send that already started finishes.
- **D13 Contract version.** The contract change is additive: a new minor version, `WIRE_VERSION`
  stays `1`. Its version is the next minor after the version on contract `main` when it merges:
  `2.5.0` on today's `main` (`2.4.0`, #806 merged), also when #815's `2.4.1` merges first.
- **D14 Secrets through `secrets-init`.** The bearer token between status and notify and the HMAC
  key are two new host secrets. `scripts/init-secrets.sh` creates them, and `secrets-init` copies
  them into new status and notify secret volumes only when `PULSE_SECRETS_SUBSCRIPTIONS=on`.
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
  status's in-flight cap, notify's per-address cooldown and send cap, the global hourly window,
  the confirmation queue and the row and pending caps (R8 table). A flood can fill the window and
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

## Scope

- contract: the wire shapes and limits of the three subscription operations, the address rule,
  the token formats and the two retention times that the notice states.
- status: the subscribe form with the visitor notice and contact, the confirm and unsubscribe
  pages, the three `POST` routes with one public subscribe answer, the call to notify, the root
  hosting rule, settings and docs.
- notify: settings with the root hosting rule, the subscription store, the private listener,
  confirmation mail, detection and fan-out of manual events to confirmed subscribers, cleanup,
  the `subscribers delete` command, metrics and docs.
- deploy: `secrets-init` and `init-secrets.sh` for the two secrets, a test-only overlay with
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
- A per-requester (per-IP) rate limit (D16), CAPTCHAs, and claims of constant response time.
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
| `POST /subscribe` | origin (below) → `403`; `content-type` not `application/x-www-form-urlencoded` (parameters allowed) → `415`; body over 2048 bytes → `413`; fields not exactly one `email` → `400`; `normalizeSubscriberEmail` fails → `400` with the form and the error `Enter a valid email address.`; then call notify, unless status's in-flight cap is full (below) | always the same `200` page, the "subscribe answer" below, for every notify outcome: `202`, `400`, `401`, `503`, any other code, a `3xx`, a timeout, a network error, a wire version mismatch, an invalid body, or no call because of the in-flight cap (D15, R8). |
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
- **In-flight cap.** At most 8 notify calls of `POST /subscribe` run at once (a constant of
  status, not a setting). A request that finds 8 in flight gets the subscribe answer at once and
  makes no call; status counts it in a log line `subscription request skipped` (no address) at
  most once per minute. The cap does not depend on the address.
- `POST` to any other path still answers `405` with `allow: GET, HEAD`. `GET /subscribe` answers
  `404` as today.
- **Origin check.** When the request has an `Origin` header, it must equal the origin of
  `PULSE_STATUS_PUBLIC_URL` (scheme, host and port; R9 makes that URL an origin), else `403`. `Origin: null` is a mismatch.
  When there is no `Origin` but a `Sec-Fetch-Site` header, it must be `same-origin` or `none`,
  else `403`. With neither header the request goes on (no-JS browsers, curl). Status never
  reads `Host`, `X-Forwarded-*` or `Referer` for this.
- **Notify call.** `requestJson` of the contract with `method: "POST"`, the body
  `JSON.stringify(...)` of the validated shape, `Authorization: Bearer <token>`, `timeoutMs` =
  `PULSE_STATUS_UPSTREAM_TIMEOUT_MS`, `maxBytes: 4096`, and `validate` =
  `validateSubscriptionAnswer`. A non-`2xx` answer, a timeout, a network error, a wire version
  mismatch or an invalid body is mapped by the table above (for `/subscribe` always to the
  subscribe answer). The notify URL is never followed through a redirect (a `3xx` is an error).
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
| `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_USERNAME` | unset | single line. |
| `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE` | unset | a file read once at startup; only with a username. |
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
- `PULSE_NOTIFY_SMTP_CLIENT_NAME` and the retry and timeout settings
  (`PULSE_NOTIFY_RETRY_*`, `PULSE_NOTIFY_TIMEOUT_MS`) also apply to subscriber mail.
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
    (event_key, subscription_id))`;
  - `meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)` with `manual_baseline_at`.
  A file with another `user_version` is refused at startup (exit `2`). Each mutation is one
  transaction.
- **Cleanup**, once at start (after the store opened, before the listener answers) and then every
  `SUBSCRIPTION_CLEANUP_INTERVAL_MS` on its own timer, independent of polls: delete `pending` rows
  whose `confirm_expires_at <= now` (`confirm_expires_at = last_sent_at +
  SUBSCRIPTION_CONFIRM_TTL_MS`); delete `seeded` and `done` events (with their deliveries) whose
  `settled_at` (or `detected_at` for `seeded`) is older than `PULSE_NOTIFY_STATE_RETENTION_DAYS`
  (`notify/src/config.ts:434`, default 30) and whose `manual_id` is not in the `listedIds` of the
  last good manual read (before the first good read no event is pruned). An expired `pending` row
  is treated as absent also before cleanup removes it. So while notify runs, an unconfirmed row is
  gone at most `SUBSCRIPTION_CONFIRM_TTL_MS + SUBSCRIPTION_CLEANUP_INTERVAL_MS` (25 hours) after
  its last confirmation mail; a stopped notify deletes it at its next start, before it answers
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
  path waits for SMTP. Each path is one transaction. The outcome (a label of
  `pulse_notify_subscription_requests_total`, R7) is noted in brackets:
  1. delete the row of `email` if it is `pending` and `confirm_expires_at <= now` (it is then
     absent for the steps below);
  2. a `confirmed` row: nothing changes, no mail (`known`). Its consent and its unsubscribe link
     stay as they were;
  3. a `pending` row with `now - last_sent_at < 600000` (10 min, L3) or `confirm_sends >= 3` (L4):
     nothing changes, no mail (`known`);
  4. a `pending` row otherwise: when the global window (L5) is full or the confirmation queue (L6)
     holds 100 jobs, nothing changes, no mail (`limited`). Else new token, new digest,
     `confirm_expires_at = now + SUBSCRIPTION_CONFIRM_TTL_MS`, `confirm_sends + 1`,
     `last_sent_at = now`, and the mail is queued (`queued`);
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
  → `200`. A `confirmed` row → `200`, nothing changes.
- **Unsubscribe** `{token}`: the token must match the unsubscribe pattern, else `400`. A wrong
  `mac` → `404`. A right `mac`: delete the row with that id and its delivery rows, if any →
  `200`. A right `mac` whose row is gone (already cancelled, or pruned) → `200`.
- **Confirmation mail** (worker 1, in memory, FIFO, at most 100 jobs, one send at a time, up to 3
  attempts with the `retryDelay` of `notify/src/delivery.ts:41-43`):
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
  - before each attempt the job checks that the row still exists with the same digest; else it
    is dropped. Jobs are lost at shutdown (the count is logged); the visitor asks again.
  - `pulse_notify_subscriber_confirmations_queued` (R7) is the number of jobs queued or in flight.
    A job leaves it only after its final outcome was counted in
    `pulse_notify_subscriber_mails_total{kind="confirmation"}` (or it was dropped, counted in
    neither). So the gauge at `0` and the success counter at a value `n` mean that exactly `n`
    confirmation mails were accepted by SMTP and none is still due.
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
  - A pass reads the eligible subscriptions in pages of 100 by `id`: `state = 'confirmed'`,
    `confirmed_at <= detected_at`, and no delivery row for this event. For each one, right before
    the send, it reads the row again by id; if the row is gone or not `confirmed`, it skips it
    (D12).
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
    `attempts`; another error → no delivery row, the subscription stays for the next pass.
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
  under every limit below, at it and below it.
- **Limits** (every finite limit on the subscribe path; each has a counterexample and a test):

| Id | Limit | Where | Effect on the public answer |
| --- | --- | --- | --- |
| L0 | 8 notify calls in flight | status | none: the subscribe answer, no call |
| L1 | `PULSE_NOTIFY_SUBSCRIPTIONS_MAX` rows | notify | none: `202`, nothing stored |
| L2 | `PULSE_NOTIFY_SUBSCRIPTIONS_MAX_PENDING` pending rows | notify | none: `202`, nothing stored |
| L3 | 10 min cooldown per pending row | notify | none: `202`, no mail |
| L4 | 3 confirmation mails per pending row | notify | none: `202`, no mail |
| L5 | `PULSE_NOTIFY_SUBSCRIPTIONS_CONFIRM_PER_HOUR` mails per sliding hour | notify | none: `202`, no mail |
| L6 | 100 queued confirmation jobs | notify | none: `202`, no mail |
| L7 | 2048-byte form body; 1024-byte notify body | status; notify | `413` before the address is read, the same for every address |
| L8 | `PULSE_STATUS_UPSTREAM_TIMEOUT_MS` per notify call | status | none: the subscribe answer |

  The incident fan-out queue (the `events` table, worker 2) is not on the subscribe path: a
  subscribe request never reads or waits for it, so its state cannot change the answer.
- **Before the address.** The origin check (`403`), content type (`415`), size (`413`), form
  fields (`400`) and the address rule (`400` with the form) run before any notify call and read
  nothing of the store. Their answers depend only on the request's own bytes.
- **No other public surface.** No route lists, counts or looks up subscriptions. Confirm and
  unsubscribe need an unguessable token (D8) and answer by the token, not the address. A
  `confirmed` address that subscribes again gets no mail, and its consent is kept, so a repeat
  neither leaks nor revokes.
- **Timing.** Status waits for notify (bounded by L8). Notify answers after one lookup and at
  most one small write, and never waits for SMTP. This spec makes no constant-time claim; it
  removes every intentional timing signal (SMTP, the fan-out queue) from the path.

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
  address), sent or failed, attempts and time. In memory only: the address in a queued
  confirmation job (at most 100 jobs, gone at restart) and the queue times of the global window
  (no address). Nothing in logs or metrics. Events hold public incident content only.
- **Retention**: pending rows as R3 "Cleanup" (gone within 25 hours of the last confirmation mail
  while notify runs); confirmed rows until unsubscribe or `subscribers delete`; delivery rows
  with their subscription or with their event after `PULSE_NOTIFY_STATE_RETENTION_DAYS`,
  whichever is first.
- **Notice** (status renders it under the input, R2; `<contact>` is the R6 contact as a link:
  `<a href="mailto:<address>">address</a>` for an address in its normalized form, `<a
  href="<url>">url</a>` for an `https` URL, both through `escapeHtml`; "24 hours", "25 hours"
  from the contract constants):

  ```html
  <div id="subscribe-notice">
  <h3>About your data</h3>
  <p>We store your email address, whether and when you confirmed it, when you subscribed, how many confirmation emails we sent, a fingerprint of your current confirmation link, and a record of each incident email to you (sent or failed, and when). We use them only to send you incident updates of this status page. We do not log your address.</p>
  <p>If you do not confirm, we delete all of it within 25 hours of the last confirmation email. The confirmation link works for 24 hours. After you confirm, we keep it until you unsubscribe.</p>
  <p>Every email has an unsubscribe link. It deletes your address and these records at once. It does not remove emails already sent, or copies in the operator's backups.</p>
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
- **A notice that is not true.** Mitigation: R10's inventory names the columns of R3; the times
  come from the contract constants that notify's cleanup uses; notify tests check cleanup at the
  literal boundaries 25 hours minus 1 ms and 25 hours.
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
| status | `test_cpu_s` (gating, budget 3.4 s, `api/bench/budgets.json:179-183`) | + up to 0.5 s | new HTTP suites with a fake notify, including the enumeration comparisons |
| status | `image_mb` | none | no new dependency |
| notify | `startup_cpu_ms`, `load_cpu_s`, `idle_rss_mib`, `peak_rss_mib`, `startup_wall_ms` | none (within noise) | off: one setting read, no listener, store or worker |
| notify | `test_cpu_s` (gating, budget 3.4 s, floor 1.5 s, `api/bench/budgets.json:216-221`) | + up to 0.8 s | new suites with SQLite and HTTP, the enumeration cases with fresh stores, and the CLI |
| notify | `image_mb` | none | no new dependency |
| contract | `test_cpu_s` (gating, 9.0 s, floor 2 s), `build_cpu_s` | + up to 0.2 s each | one small module |
| api, probe | all | none | not changed |

With subscriptions on, notify holds one page of 100 rows and one message at a time, so its RSS grows
by the SQLite page cache and not by the number of subscribers.

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
  for addresses, tokens and secrets.
- **Auth order and status codes**: notify R4 (path, method, then auth before any body read);
  status R2 (origin before body); exact codes in R1 and R2; one public subscribe answer for
  every valid address under every limit L0-L8 (R8), checked byte for byte with known and unknown
  addresses.
- **Body and size limits**: status 2048 bytes; notify `SUBSCRIPTION_MAX_BODY_BYTES` 1024; status
  reads at most 4096 bytes of a notify answer; row cap, pending cap, queue cap, window cap,
  status in-flight cap.
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
  delete` takes the store lock; secrets-init writes the new secrets through its temp-and-rename
  path, `0400`.
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
     visitor gets the same subscribe answer as always (D15), status logs the failure kind, and
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
- Feature off: `POST /subscribe` → `405`; `GET /subscribe/confirm?token=…` → `404`; the page has no
  `id="subscribe"`; the CSP has `form-action 'none'`.

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

### No enumeration (R8), at every limit and below it

Each case compares two answers byte for byte (status code, every header except `date`, body):
the answer for a known address K and for an unknown address U, from a fresh fixture each time so
the first request cannot change the second's state, in both orders (K then U, U then K). Notify
cases compare notify's answers; status cases compare status's answers.

| Case | Fixture | K | Must also hold |
| --- | --- | --- | --- |
| below every limit | empty window, 1 row | confirmed; pending in cooldown; pending at send cap; expired pending | U gets a row and a mail |
| L1 full | `MAX = 2`, 2 rows | confirmed; pending | U: no row, no mail; K unchanged |
| L2 full | `MAX = 10`, `MAX_PENDING = 1`, 1 pending row | confirmed; the pending row | U: no row |
| L3/L4 | pending K in cooldown / at 3 sends | — | U below other limits gets a mail; the answers are still equal |
| L5 full | `CONFIRM_PER_HOUR = 1`, one mail queued | confirmed; pending past cooldown | neither gets a mail |
| L6 full | 100 jobs queued (fake `sendMail` that never resolves) | confirmed; pending past cooldown | neither gets a mail |
| L0 full (status) | fake notify that holds 8 calls | any | the 9th request makes no call |
| L8 (status) | fake notify that never answers, `PULSE_STATUS_UPSTREAM_TIMEOUT_MS = 200` | any | same answer as for a `202` |
| notify outcomes (status) | fake notify answers `202`, `400`, `401`, `429`, `503`, `302`, `200` with a bad body, `202` with `x-pulse-contract: 2`, a closed socket | — | all nine answers are byte-equal to each other |

A wrong implementation that answers `429` or `503` only when the store has no row for the
address, or that sets a header (`retry-after`, `set-cookie`) only on one path, fails here.

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
- A send that started before an unsubscribe ends with success; no further send to that row.
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
`secure_delete`, `/subscribe`, `9300`: no match. `subscription`, `subscriber` and
`unsubscribe` appear only as unrelated words: a comment in `notify/src/metrics.ts:5`,
`notify/src/alert-poll.ts:19-34` (`isSubscribed`, channel alert opt-in; the new notify modules do
not reuse that name) and local `unsubscribe` variables in `deploy/cli/*.ts`. #570's spec uses
none of these names (`grep -n -i 'subscri' .factory/work/570/plan.md` shows only the non-goal
line 703).

Status routes `/subscribe`, `/subscribe/confirm`, `/unsubscribe`; the page anchors
`#subscribe` and `#subscribe-notice`; notify routes of `SUBSCRIPTION_ROUTES`; notify metrics of
R7; status variables of R6; notify variables of R3; the notify command `subscribers delete`
(next to the existing `failed`, `notify/src/index.ts:443`).

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
  answers, the one subscribe answer, the in-flight cap)
- `src/subscribe-client.ts` (new: the call to notify with `requestJson`)
- `src/subscribe-pages.ts` (new: the form section with the R10 notice and contact link, and the
  result pages)
- `src/server.ts` (changed: `ServerOptions` gets the subscription options; the method gate lets
  the three `POST` routes through when on; CSP `form-action`; the `{{subscribe}}` placeholder;
  `contractModules` adds `subscriptions.js` and `validate-subscriptions.js`, and every other module
  that the new contract's `index.js` imports, see `src/server.ts:189-206`)
- `src/settings.ts` (changed: R6, the contact rule, the R9 root rule)
- `src/start.ts` (changed: passes the settings and reads the token file)
- `public/index.html` (changed: `{{subscribe}}` after the maintenance list)
- `public/page.css` (changed: form and notice styles, readable at 360 px)
- `src/subscribe-routes.test.ts` (new: real server on port 0 with a fake notify on port 0)
- `src/subscribe-enumeration.test.ts` (new: the status cases of "No enumeration (R8)")
- `src/settings.test.ts` (changed)
- `src/server.contract-modules.test.ts` (changed only if the served list needs a new assertion)
- `e2e/run.ts` (changed: axe checks of the page with the form and of the five result pages, at 360
  and 1280 px, light and dark, with and without JavaScript)
- `README.md`, `docs/configuration.md`, `docs/operation.md` (changed: settings, routes, the root
  hosting rule of R9, the notice and operator duties of R10, known limits D-R3, D-R4, D-R9,
  D-R10)
- `package.json`, `bun.lock` (changed: contract pin to the merged full SHA of the contract child)

Behavior change: yes. New public form, pages and `POST` routes when configured.

Behavior: R2, R6, R7 (status parts), R8 (status side: one subscribe answer, L0, L7, L8), R9
(status side), R10 (notice and contact). Off by default with today's answers.

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
- `src/subscribe-enumeration.test.ts`: every status row of "No enumeration (R8)" (L0, L8 and the
  nine notify outcomes), each comparing two real HTTP answers byte for byte (status, headers
  except `date`, body) for `sub-k@e2e.invalid` and `sub-u@e2e.invalid`, in both orders, with a new
  server and fake notify per case. The test also asserts the literal subscribe answer text of R2
  (with `24 hours` and the contact link), and that the answer has no `location`, `retry-after`,
  `set-cookie` or `etag` header. The expected bytes are not read from the code under test: the
  test compares two answers to each other and checks the literal text.
- Notice (R10): `GET /` with subscriptions on holds each literal sentence of the R10 notice, with
  `25 hours` and `24 hours`, inside `id="subscribe-notice"`, between the input and the button,
  and the input's `aria-describedby="subscribe-notice"`; the "Visitor notice and contact"
  counterexamples with their literal outputs. The `400` invalid-address page holds the notice too.
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
  link, press the button; report the commands and the codes.

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
- `src/subscriber-fanout.ts` (new: detection input, worker 1 and worker 2)
- `src/index.ts` (changed: wiring, second lock, listener start before the notifier, stop order,
  the `subscribers` command next to `failed` at `:443-444`)
- `src/notifier.ts` (changed: hands each good manual read and `listedIds` to the fan-out)
- `src/metrics.ts` (changed: R7 series)
- `Dockerfile` (changed: `PULSE_NOTIFY_SUBSCRIPTIONS_HOST=0.0.0.0` next to the health host)
- `test/subscriptions-store.test.ts`, `test/subscriptions-server.test.ts`,
  `test/subscriptions-fanout.test.ts`, `test/subscriptions-settings.test.ts`,
  `test/subscriptions-security.test.ts`, `test/subscriptions-enumeration.test.ts`,
  `test/subscribers-cli.test.ts` (new)
- `README.md`, `docs/configuration.md`, `docs/operation.md`, `docs/channels/email.md` (changed:
  settings, the listener, the root hosting rule (R9), the data inventory and retention of R10,
  `subscribers delete` and the operator procedure for a deletion request, known limits
  D-R1..D-R11, backup of the store)
- `AGENTS.md` (changed: the new modules in "This repository"; the ledger line says format 4, not
  3, as `src/ledger.ts:31` has)
- `package.json`, `bun.lock` (changed: contract pin to the merged full SHA)

Behavior change: yes. A new listener, store and subscriber mail when configured.

Behavior: R3, R4, R5, R7, R8 (notify side: `202` for every valid subscribe request, L1-L6), R9
(notify side), R10 (inventory and retention as stored). With `PULSE_NOTIFY_SUBSCRIPTIONS` unset,
the service, its ledger, its channels, `failed list|resend`, `/healthz`, `/readyz` and `/metrics`
behave exactly as on `main`; only the new `subscribers delete` command exists.

Shared finding: as in the status section, the wire texts are fixed by R1 and R4; a gap found by
either child is a shared finding that the other reads first.

Checks (fake `sendMail` from `test/smtp-stub.ts`, injected clock and sleep, `mkdtemp` stores):
- Every "Notify listener", "Lifecycle and timing", "Eligibility and privacy", "Fan-out failures"
  and "`subscribers delete`" counterexample, with the literal expected codes, outputs and send
  counts written in the test.
- `test/subscriptions-enumeration.test.ts`: every notify row of "No enumeration (R8)" (below
  every limit, L1, L2, L3/L4, L5, L6, store error), each with a fresh `mkdtemp` store, real HTTP to
  the listener, both orders, comparing the two answers byte for byte (status, headers except
  `date`, body) and asserting the literal `{"status":"accepted"}`. After each case the test
  checks the store and the fake sender: rows and mails exactly as the table's "Must also hold"
  column says (literal counts), and a confirmed K is still `confirmed` with the same `id`.
- Cleanup and retention: the "Cleanup boundaries" counterexample with a fake timer; a deleted row
  leaves no trace in a second connection, and after the checkpoint the `-wal` file has size `0`;
  a search of the store file's bytes for the deleted address finds nothing (secure delete).
- R9: the notify rows of "Root hosting (R9)" with their literal results; the refused start leaves
  no store file, no lock file and no listener.
- The acceptance tests that the issue names: (1) an unconfirmed address gets 0 incident sends while
  a confirmed one gets 3 (opened, update, resolved) for the same incident; (2) after unsubscribe
  the address gets 0 sends for a new incident while a second confirmed address gets 1; (3) a draft,
  a draft update, a note and an internal incident in the api's private data (served by the fake
  api only under `/admin`, not in `/manual-incidents`) produce 0 sends, and publishing the draft
  produces exactly 1 per confirmed address.
- The server tests start the real listener on `127.0.0.1:0` and type every answer with the contract
  validators.
- `test/subscriptions-security.test.ts`: the store file and its lock are mode `0600`; no log line
  (captured logger) holds the address, a token, the key or the bearer token after a full flow with
  a failing SMTP; the metric output holds no address; a confirmation and an incident message have
  exactly one `To` address and no CR/LF in `Subject`; no listener answer body (every route, every
  status code of R1) holds the request's token or address.
- Pass budget: every "Pass budget across restarts" counterexample, each with a real stop and a
  new worker over the same `mkdtemp` store file (not the same object), and the fake's call count
  per row as a literal.
- `pulse_notify_subscriber_detections_total`: grows by 1 per poll whose manual read answered
  (also a seeding poll and a poll with no new key); does not grow on a manual-feed error or a
  404; grows only after the event rows are readable from a second connection to the store.
- `pulse_notify_subscriber_confirmations_queued`: `1` while a confirmation send waits (fake
  sender held), `0` after it resolved, and the success counter grew by exactly `1` before the
  gauge reached `0`.
- Settings: each required variable missing → exit `2` naming it; a key of 63 or 65 hex
  characters, or with upper case → error; `off` opens no file (the test passes a state directory
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
  every other secret, are kept on a rerun, are never printed)
- `scripts/secrets-init.mjs` (changed: `PULSE_SECRETS_SUBSCRIPTIONS`)
- `scripts/secrets-init.test.sh` (changed)
- `e2e/compose.subscriptions.yaml` (new, test only)
- `e2e/subscriptions.sh` (new: the scenario)
- `e2e/subscriptions.test.sh` (new: the scenario's parsing helpers on fixed mailpit answers, and
  `docker compose ... config --quiet` of the overlay with both base files)
- `e2e/compose-e2e.sh` (changed: the step "Email subscriptions" after "Console probe locations"
  and before "Persistence across down and up", `e2e/compose-e2e.sh:1097-1121`)
- `scripts/check-setup.sh`, `scripts/check-setup.test.sh` (changed: the overlay combinations
  `e2e-subs` and `e2e-dev-subs` with their published ports, rule 5 at `check-setup.sh:74-91`)
- `.github/workflows/ci.yml` (changed: a `lint` step `bash e2e/subscriptions.test.sh` after
  `:55`; in `e2e-dev`, `grep -qx 'ok: email subscriptions' e2e-dev.log` after `:306`)
- `README.md` (changed: secrets model, port table, e2e test)
- `full/README.md` (changed: how to turn subscriptions on with an override file; root hosting;
  the contact; deletion requests and backups)

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
  - any other value: fail `PULSE_SECRETS_SUBSCRIPTIONS: must be on or off`;
  - generate mode with `on`: fail `PULSE_SECRETS_SUBSCRIPTIONS: files mode only`.
- `e2e/compose.subscriptions.yaml` (merged after the base file and `e2e/compose.e2e.yaml`, test
  only, comment header like `e2e/compose.e2e.yaml:1-5`):
  - `secrets-init`: `PULSE_SECRETS_SUBSCRIPTIONS: "on"` and the volumes
    `status-secrets:/out/status`, `notify-secrets:/out/notify`;
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
    can reach L1 with six addresses), volume `notify-secrets:/run/pulse:ro`, `depends_on`
    `secrets-init` completed and `mailpit` started;
  - top-level volumes `status-secrets`, `notify-secrets`.
- `full/README.md` documents the same keys as an operator override, with a real SMTP server, TLS
  `starttls` or `tls`, `PULSE_NOTIFY_SUBSCRIPTIONS_SMTP_PASSWORD_FILE` through a secrets volume,
  and one `.env` variable `PULSE_STATUS_PUBLIC_URL` that the override passes to both
  `PULSE_STATUS_PUBLIC_URL` (status) and `PULSE_NOTIFY_SUBSCRIPTIONS_STATUS_URL` (notify), so the
  two cannot differ. It states the root rule of R9 with the sentence of R9, the contact setting
  `PULSE_STATUS_SUBSCRIPTIONS_CONTACT`, the operator duties of R10 (answer the contact; delete
  on request with `docker compose -f full/compose.yaml stop notify`, then `docker compose -f
  full/compose.yaml run --rm --no-deps notify bun --no-env-file src/index.ts subscribers delete
  <address>`, then `start notify`; keep backups of the notify volume for a stated time, D-R7,
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
     your address and these records at once.`, and
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
     D's confirmation (worker 1 is one FIFO queue, so every job queued before D's has been
     handled), then until `pulse_notify_subscriber_confirmations_queued` is `0`. A still has
     exactly 1 message, and
     `pulse_notify_subscriber_mails_total{kind="confirmation",outcome="success"}` is exactly `4`.
  5. For A and C: take the path and query of the confirm link, `GET` it on
     `127.0.0.1:<status port>` → `200` with a form; `POST /subscribe/confirm` with that token →
     `200`. B and D stay pending. The store now has 4 rows; `PULSE_NOTIFY_SUBSCRIPTIONS_MAX` is 5.
  5a. **Below capacity, known versus unknown** (R8). Send `POST /subscribe` for A (confirmed), D
     (pending, in cooldown) and E (unknown), in that order, each with the same request headers,
     including `Host: evil.example`, `X-Forwarded-Host: evil.example` and
     `X-Forwarded-Proto: https`. Save each answer's status, headers and body with `curl -sS -D`.
     The three status codes are `200`; the three bodies are byte-equal (`cmp`); the three header
     lists without the `date` line are byte-equal; no answer has `location`, `retry-after`,
     `set-cookie` or `etag`, and none holds `sub-`, `@e2e.invalid` or `evil.example`. Then wait
     until `pulse_notify_subscriber_confirmations_queued` is `0`: the confirmation success
     counter is exactly `5`; `pulse_notify_subscription_requests_total{route="subscribe",
     outcome="known"}` grew by exactly `2` and `outcome="queued"` by exactly `1` (positive
     controls that the store saw both kinds). E has exactly 1 message; every link in it starts
     with `http://status.e2e.invalid/` and no part of it holds `evil.example` (R9). A and D still
     have exactly 1 message each. The store now has 5 rows (full).
  5b. **At capacity, known versus unknown** (R8). Send `POST /subscribe` for F (unknown), A
     (confirmed), F again, and D (pending), with the headers of 5a. All four answers are compared
     as in 5a with each other and with the saved E answer of 5a: all byte-equal (except `date`).
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
- `README.md`: the two new secrets, the `PULSE_SECRETS_SUBSCRIPTIONS` switch, the mailpit port of
  the subscription overlay in the port table, and the new scenario.
- `scripts/check-setup.sh`: `compose_args` gets `e2e-subs` (`-f full/compose.yaml -f
  e2e/compose.e2e.yaml -f e2e/compose.subscriptions.yaml`) and `e2e-dev-subs` (the same with
  `dev/compose.yaml`). `expected_ports` for both is the `e2e` list plus
  `mailpit 127.0.0.1 8025 8025`, written literally. The loop of `:92` runs over them too, so rule 8
  (only a `*-secrets` volume at `/run/pulse`) covers the new status and notify mounts.
  `check-setup.test.sh` gets one broken copy of the overlay with mailpit on `0.0.0.0` and expects
  the rule 5 failure.

Checks:
- `bash scripts/secrets-init.test.sh` (Docker): `on` with valid inputs writes the three files
  `0400` `1000:1000`; a missing input, a 63-character value, an upper-case value, equal values, a
  value equal to the probe token, a missing `/out/status` each fail with the literal rule line and
  write nothing; no output holds a value; `off` writes none of the files.
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
  and `429`, when the bodies differ by one byte, and when a body holds `sub-u@e2e.invalid`.
- `e2e/subscriptions.test.sh` checks the notice matcher of step 2 against a fixed page text: it
  fails when `25 hours` is replaced by `24 hours` in the deletion sentence, and when the contact
  link is missing.
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
   address through the documented operator command, and no later incident mail reaches it.

Issue review checks 1-9 map to: 1 → item 4 (steps 3-6); 2 → item 6; 3 → items 1 and 4 (steps 9,
11a) and the notify "Fan-out failures"; 4 → item 4 (steps 7-8) and item 1; 5 → item 7; 6 → item 8;
7 → notify security and pass-budget tests (item 1); 8 → deploy "Barriers" and its
`subscriptions.test.sh`; 9 → items 4 and 5.
