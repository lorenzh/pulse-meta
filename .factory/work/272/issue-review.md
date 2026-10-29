# Issue review: #272 Notify: replace the own SMTP client with nodemailer

Single target: `notify`. No contract or API change. Read against `.repos/notify` (main).

## Current state (checked)
- `src/channels/smtp.ts` (385 lines, not ~305): `sendMail(smtp, message)`, `SmtpError`, `DEFAULT_CLIENT_NAME`, `isEhloName`, `ehloNameFrom`, `dotStuff`, `SendMail` type, loopback/TLS rule, one whole-attempt timer with stage names, abort signal, reply line/byte limits.
- `src/channels/email.ts` builds headers and base64 body by hand (`encodeHeader`, `wrap76`, `messageId`, `bodyText`, `envelopeAddress`), then calls the injected `opts.sendMail`.
- Also importing smtp/email: `src/index.ts`, `src/notifier.ts`, `src/config.ts`, `src/types.ts`, `src/channels/factory.ts`, `src/channels/message.ts`.
- Tests: `test/smtp.test.ts` (about 22 tests), stub `test/smtp-stub.ts`, `test/channels.test.ts`.
- Docs: `docs/channels/email.md` says "own small SMTP client ... no extra dependency"; `AGENTS.md` line 101-102 names `smtp.ts`.
- Dockerfile: build stage `npm ci --omit=dev --ignore-scripts` with git installed, runtime stage copies `node_modules`. Nodemailer has no install scripts, so this should work unchanged; verify.

## Open points (none blocks the spec)
1. **Abort/timeout mapping.** Nodemailer has no `AbortSignal` and its timeouts (`connectionTimeout`, `greetingTimeout`, `socketTimeout`) are per phase, not one for the attempt. Keep the own whole-attempt timer plus the signal around `sendMail`, and call `transporter.close()` on timeout/abort. Set the nodemailer timeouts to the attempt budget so they never fire first. The stage name in the timeout message (tested in "attempt timer firing mid-conversation names the stage") cannot be kept exactly; the test is adapted to assert a timeout error and the retryable class.
2. **Error classification.** Map nodemailer errors: `responseCode` >= 500 (and `code` `EENVELOPE`/`EMESSAGE` with 5xx) -> `PermanentDeliveryError`; 4xx and `ECONNECTION`/`ETIMEDOUT`/`ESOCKET` -> retryable. `EAUTH` -> message with the code only, never `err.response`/`err.message` from the server. Nodemailer error messages can embed server text; build messages from fixed text plus codes only. Same for logs (nodemailer `logger` stays off).
3. **TLS modes.** `starttls` -> `secure:false, requireTLS:true`; `tls` -> `secure:true`; `none` -> `secure:false, ignoreTLS:true`. Keep the refusal of login without TLS to a non-loopback host before any connection (own check stays, in email.ts or a small helper). Certificate verification stays on.
4. **AUTH.** Existing tests expect PLAIN, LOGIN fallback, and a failure when no common mechanism exists. Nodemailer picks the mechanism itself (and could pick CRAM-MD5 / XOAUTH2). Plan must set `authMethod` explicitly or adapt the "PLAIN sends credentials in one command" assertion. Decision assumed: restrict to PLAIN and LOGIN to keep behavior.
5. **Reply-limit test** (too many lines/bytes) and **STARTTLS injected-reply test** test own-parser internals. Nodemailer's parser differs. Assume: keep the STARTTLS injection test as acceptance (must still not deliver / must fail retryable) and drop or adapt the line/byte-limit test; the spec states this explicitly.
6. **Message content.** Headers by hand go away; use `from`, `to`, `subject`, `text`, `date`, `messageId`, `headers` options (never `raw`). Keep deterministic Message-ID from the notification key (`<hash@domain>`) and Date from the injected `now`. Nodemailer chooses its own transfer encoding (quoted-printable/base64) and RFC 2047 subject encoding; the body line endings and exact bytes change. Tests asserting on raw bytes are adapted to decoded content. Header injection: addresses and subject with CR/LF must still be rejected (existing test "a line break in an address").
7. **Envelope vs header addresses.** `from`/`to` can be `Name <addr>`; nodemailer parses these itself, so `envelopeAddress` may be dropped. An unparseable address becomes a permanent error (assumption).
8. **EHLO name.** Map `clientName` -> nodemailer `name`. Keep `isEhloName`/`ehloNameFrom` (config validation and hostname fallback are not replaced by nodemailer); only the client goes. Note nodemailer also sends `localAddress`/`name` default of hostname; the default stays `localhost` per current code.
9. **Pinning.** "Latest release" is resolved by the implementer at build time with `npm view nodemailer version`; pin exactly (no `^`) in package.json and the lockfile. Add `@types/nodemailer` as an exact-pinned devDependency (nodemailer ships no types; the "zero runtime dependency" claim is unaffected). Spec should state this and that `any` stays banned in the adapter.
10. **Transport lifecycle.** One transporter per send (pool off) so the timeout/abort can close it and no idle socket survives. Assumption.
11. **Testing style.** AGENTS.md forbids mocking Node modules; the real SMTP stub is the acceptance test, and the `sendMail` option stays an injectable dependency in `EmailOptions` (hand-written fake) for channel tests. Type `SendMail`/`SmtpMessage` may move into `email.ts` or a small `mailer.ts`; the name is the plan's choice.
12. **Metrics/logs.** Check no nodemailer error containing the host auth user/password or URL is logged; add a test that a failing AUTH echoing the password does not reach the error message (existing credential-echo test covers it).
13. Issue says smtp.ts is ~305 lines; actually 385. Cosmetic.
14. Issue references #166 (shared-code plan); no dependency on in-flight features found.

## Assumptions
- Node >=24, nodemailer's `createTransport({ host, port, ... }).sendMail(...)` is the only API used.
- No config key changes; no docs change to config keys. Limits that change (timeout stage names, reply-size limits, AUTH mechanisms) are documented in `docs/channels/email.md`.
- Docs also mention nodemailer; `docs/install.md` line "image holds only production dependencies" stays true (now includes nodemailer).

## Derived acceptance check
In `notify`, with nodemailer pinned exactly in `package.json` and `package-lock.json` and `smtp.ts` plus the hand-written MIME helpers deleted (no `raw` option anywhere):
- `npm run check` passes, with the SMTP stub tests (plain and TLS, STARTTLS verified and required, AUTH PLAIN/LOGIN, 4xx retryable, 5xx permanent, AUTH failure with no server text, credential echo, EHLO name, whole-attempt timeout, abort, login over `none` to a remote host refused) green.
- A new test sends a check name and prefix with non-ASCII characters (for example `Prüfung 日本`) and the stub receives a correctly RFC 2047 encoded Subject that decodes back to the original.
- `docker build` of notify succeeds with `--omit=dev --ignore-scripts` and `node -e "import('nodemailer')"` works in the image.
- `docs/channels/email.md` names nodemailer; `AGENTS.md` names it as the approved SMTP library.
