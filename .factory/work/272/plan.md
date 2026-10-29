# Spec #272: Notify: replace the own SMTP client with nodemailer

Step S3 of the shared-code plan in #166. Open points and the acceptance check come from `.factory/work/272/issue-review.md`; the numbers below refer to its open points.

## Goal

Replace the hand-written SMTP client (`src/channels/smtp.ts`, 385 lines) and the hand-written MIME code in `src/channels/email.ts` of `pulse-notify` with nodemailer. Reviews found a STARTTLS reply-queue flaw and other protocol edge cases in the own client.

## Scope

Only the `notify` repository. No contract or API change, no config key change, no change for other targets.

## Non-goals

- No change to Slack, Teams, webhook or file channels.
- No new email features (HTML mail, attachments).
- No change to the `clientName`/`isEhloName`/hostname fallback logic (nodemailer does not replace it).

## Required behavior

- Dependency: the latest nodemailer release, resolved with `npm view nodemailer version` at build time, pinned exactly (no `^`) in `package.json` and `package-lock.json`. `@types/nodemailer` as an exact-pinned devDependency (nodemailer ships no types). `any` stays banned in the adapter.
- Use only `createTransport({...}).sendMail({...})`. The `raw` option is never used. Message fields: `from`, `to`, `subject`, `text`, `date` (from injected `now`), `messageId` (deterministic from the notification key, `<hash@domain>`, as today), `headers` where needed.
- One transporter per send, pool off; it is closed after the attempt so no idle socket survives (point 10).
- TLS modes (point 3): `starttls` -> `secure:false, requireTLS:true`; `tls` -> `secure:true`; `none` -> `secure:false, ignoreTLS:true`. Certificate verification stays on. The existing rule stays and runs before any connection: login without TLS to a non-loopback host is refused.
- AUTH (point 4): credentials from env or file as today. Restrict to PLAIN and LOGIN (set `authMethod`/equivalent explicitly so CRAM-MD5 and XOAUTH2 are never chosen). No common mechanism -> failure.
- EHLO name (point 8): `clientName` -> nodemailer `name`; default `localhost` stays.
- Timeout and abort (point 1): keep an own whole-attempt timer and the `AbortSignal` around `sendMail`; on timeout or abort call `transporter.close()`. Set nodemailer's `connectionTimeout`, `greetingTimeout`, `socketTimeout` to the attempt budget so they never fire first. Timeout and abort are retryable errors.
- Error classification (point 2): `responseCode` >= 500 (also `EENVELOPE`/`EMESSAGE` with 5xx) -> `PermanentDeliveryError`; 4xx, `ECONNECTION`, `ETIMEDOUT`, `ESOCKET` and other network errors -> retryable. `EAUTH` -> message from fixed text plus code only. Error messages are built from fixed text plus codes, never from `err.message`/`err.response` of the server. Nodemailer `logger`/`debug` stay off. Logs and `/metrics` never contain passwords or URLs with credentials.
- Addresses and subject with CR/LF are rejected as before; an unparseable address is a permanent error (point 7). `envelopeAddress` may go.
- Subject and headers with non-ASCII text (for example `Prüfung 日本`) are correctly RFC 2047 encoded by nodemailer.
- Existing behavior stays: `hideReason`, reminder and resolved texts.
- `hideReason`, `message.ts` text cleaning and the injectable `sendMail` option of `EmailOptions` stay (hand-written fake in channel tests, point 11).

## Risks

- Nodemailer error messages can embed server text: classify by code only (point 2).
- Transfer encoding and line endings of the body change; raw-byte tests must decode content (point 6).
- Docker build: `npm ci --omit=dev --ignore-scripts` must install nodemailer (no install scripts expected); verify.
- Stage names in timeout messages cannot be kept (point 1).

## Acceptance evidence

- `npm run check` passes in `notify`.
- The SMTP stub tests stay the acceptance tests: plain and TLS, STARTTLS verified and required, AUTH PLAIN and LOGIN fallback, no common mechanism, 4xx retryable, 5xx permanent, AUTH failure with no server text, credential echo, EHLO name default and override, whole-attempt timeout, abort, login over `none` to a remote host refused, line break in an address rejected.
- New test: non-ASCII check name and prefix produce a correctly encoded Subject that decodes to the original.
- `docker build` succeeds and `node -e "import('nodemailer')"` works in the image.
- No `smtp.ts`, no hand-written MIME helpers, no `raw` anywhere (`grep`).

## Repository: notify

Files:
- `package.json`, `package-lock.json`: add `nodemailer` (exact) and `@types/nodemailer` (exact, dev).
- Delete `src/channels/smtp.ts`. Keep `DEFAULT_CLIENT_NAME`, `isEhloName`, `ehloNameFrom` and the `SendMail`/message types in `email.ts` or a small module named after its job (for example `mailer.ts`); update imports in `src/index.ts`, `src/notifier.ts`, `src/config.ts`, `src/types.ts`, `src/channels/factory.ts`, `src/channels/message.ts`. Remove `encodeHeader`, `wrap76`, `dotStuff` and other MIME helpers nodemailer replaces. Keep each module small and one responsibility; cognitive complexity per function <= 15.
- Implement the nodemailer adapter with the behavior above (loopback helper in `src/channels/loopback.ts` stays).
- Tests: `test/smtp.test.ts` and `test/smtp-stub.ts` stay the acceptance tests; adapt only what tests removed internals: the "attempt timer firing mid-conversation names the stage" test asserts a retryable timeout error; the reply line/byte-limit test is dropped or adapted; the STARTTLS injected-reply test stays and must not deliver and must fail retryable; the `PLAIN sends credentials in one command` assertion works with the AUTH restriction; byte assertions decode content. Adapt `test/channels.test.ts` as needed. Rename test files if smtp.ts is gone (for example `test/email-smtp.test.ts`). Add the non-ASCII subject test. Follow TDD, no mocks of Node modules, no real clock.
- Docs: `docs/channels/email.md` drops "own small SMTP client ... no extra dependency", names nodemailer and documents changed limits (AUTH mechanisms PLAIN/LOGIN, timeout message without stage names, reply size limits those of nodemailer). `AGENTS.md` ("This repository" channels line) names nodemailer as the approved SMTP library and no longer names `smtp.ts`; fix its `smtp.ts` mention for permanent errors. Update `README.md` and `docs/install.md`/`development.md` if they mention the own client or "no runtime dependency".
- Dockerfile: expect no change; verify the build with `--omit=dev --ignore-scripts`.

Checks: `npm run check`; `docker build .`; start with `npm start` against a local stub once and report command and result.

Completion evidence: the acceptance evidence list above, in the PR description (`Closes lorenzh/pulse-meta#<child>`).
