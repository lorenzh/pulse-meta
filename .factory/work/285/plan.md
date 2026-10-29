# Spec #285: Notify SMTP, an early abort can reconnect and deliver later

## Goal
After an abort or timeout, `sendMail` in `pulse-notify` opens no connection and sends nothing, whether the cancel comes before, during or after connection setup. Fixes the P2 error from the re-review of lorenzh/pulse-notify#24 (spec `.factory/work/272/plan.md`, timeout and abort).

## Scope
Only `notify`: `src/channels/smtp-send.ts`, `test/smtp-stub.ts`, `test/email-smtp.test.ts`, and `docs/channels/email.md` only if its timeout paragraph needs a word.

## Non-goals
No change to AUTH, TLS modes, error classification, error messages (no server text), or other channels. No change to `contract`, `api` or other targets.

## Current behavior (checked in `.repos/notify`)
`sendMail` creates an unconnected `Socket`, passes it as `socket` to `createTransport`, then calls `transporter.sendMail()`. Nodemailer connects that socket in deferred setup. Abort or timeout only rejects the `limit` promise; `finally` calls `transporter.close()` and `socket.destroy()`. Nodemailer's deferred connect can still run on the destroyed socket, so it reconnects and may deliver. An already-aborted signal also only rejects, and `transporter.sendMail()` is still called. The existing abort tests abort only after the connection exists.

## Required behavior
- Already-aborted signal at call: reject with `SmtpError("SMTP send aborted")` (retryable) before any socket or transport is created.
- Abort or timeout (injected `schedule`) at any later point: reject as today (`SMTP send aborted`, `SMTP send timed out after <ms>ms`, same classes, retryable), and afterwards no connection is opened, no socket stays open, no byte is written, no message is delivered.
- Chosen approach (implementer may pick an equivalent that meets the behavior): keep a `cancelled` flag set by timeout and abort. Make the socket refuse to connect once cancelled (a `Socket` subclass or wrapper whose `connect` is a no-op/destroys when cancelled), destroy it on cancel, and check the flag before `transporter.sendMail()`. Alternative: connect the socket first, then create the transport. Also cover abort during TLS/STARTTLS setup and after DATA began (best effort: destroy; nothing further written).
- Late nodemailer callbacks or rejections after cancel must not throw or become unhandled; keep the no-op `error` listener and `sending.catch`.
- Existing behavior stays: HELO fallback refusal, `finally` cleanup (cancel timer, detach listener, `transporter.close()`, `socket.destroy()`).

## Risks
- A connect guard that breaks nodemailer's normal connect or STARTTLS upgrade: keep the normal path green with existing tests.
- Tests that depend on timing: use stub-side events and a bounded wait, not a fixed sleep where avoidable; no real clock for the timeout (use injected `schedule`).

## Repository: notify
Files and work (TDD, hand-written stubs, no Node module mocks):
1. `test/smtp-stub.ts`: add counters to the stub, such as open socket count and accepted connection count (and a way to wait until they settle). Existing `messages` shows delivery. Silent stub (`isSilent`) and accepting stub already exist.
2. `test/email-smtp.test.ts`: add regression tests first; they must fail on current `main`:
   - Silent stub: start `sendMail`, abort synchronously right after the call; rejects `/aborted/`; after a bounded wait, zero open sockets and no connection accepted after the abort.
   - Accepting stub: same abort; rejects; `messages` is empty (delivered 0) and zero open sockets.
   - Signal already aborted before the call: rejects, no connection accepted, nothing delivered.
   - Timeout fired through the injected `schedule` before the connection exists: same result (silent and accepting).
3. `src/channels/smtp-send.ts`: implement the required behavior above.
4. `docs/channels/email.md` (line ~36): keep accurate; adjust only if it claims otherwise.

Checks: `npm run check` passes (lint, types, tests, coverage rules of the repo).

Completion evidence: PR with `Closes lorenzh/pulse-meta#<child>`, new tests failing on `main` (reproducing `deliveredAfterAbort: 1` and the open socket) and passing after the fix; existing abort and timeout tests green.

## Acceptance evidence
In `notify`, `npm run check` green, with the new abort-before-connection tests (silent and accepting stubs, pre-aborted signal, early timeout) showing zero open sockets and zero delivered messages.
