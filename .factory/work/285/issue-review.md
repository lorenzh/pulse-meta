# Issue review: #285 Notify SMTP, an early abort can reconnect and deliver later

Verdict: specifiable. Single target: `notify`. No `contract`/`api`/other change. No blocking question.

## Current behavior (checked in `.repos/notify/src/channels/smtp-send.ts`)
- `sendMail` creates `new Socket()` (unconnected) and passes it as `socket` to `createTransport`. Nodemailer connects that socket in deferred setup after `transporter.sendMail()` starts.
- Abort/timeout only rejects the `limit` promise. `finally` runs `transporter.close()` and `socket.destroy()`. A destroyed Socket can still be reconnected by nodemailer's deferred `connect`, so it reopens and may deliver (`deliveredAfterAbort: 1`).
- `signal.aborted` already true at start also only rejects; `transporter.sendMail()` is still called.
- Existing tests: `test/email-smtp.test.ts` "an abort signal stops the send" (~206) and "an abort closes the connection to the server" (~347) abort only after the connection exists, so they miss this.

## Open points (none blocking)
1. Fix approach is left open by the issue. Assumption: the plan picks one, preferably: check `signal`/timer state before `transporter.sendMail()`, and make the socket unusable after cancel (for example a cancelled flag, with a socket subclass or `connect` guard that refuses to connect, or connect the socket first and then create the transport). Whichever is chosen must also cover abort during TLS/STARTTLS setup and after the DATA stage has begun (best effort: destroy, nothing further is written).
2. "Timeout" has the same hole as abort (same code path). Assumption: fix covers both; the injectable `schedule` fires the timeout in tests, no real clock.
3. Already-aborted signal before `sendMail` is called: assumption it rejects with `SMTP send aborted` (retryable, as today) without creating a socket or transport.
4. Error type stays: `SmtpError` retryable for abort/timeout. Messages unchanged (no server text).
5. Unhandled rejections: nodemailer callbacks after cancel must not throw or leak; keep the no-op `error` listener and `sending.catch`.
6. Scope: no change to AUTH, TLS modes, classification, docs behavior. Docs only if the timeout/abort paragraph in `docs/channels/email.md` claims otherwise (check).

## Assumptions
- The test stubs in `test/smtp-stub.ts` can report open sockets and received messages; a "silent" stub (accepts, never answers) and an "accepting" stub (full SMTP) both exist or are small additions.
- "Abort before the connection exists" = abort called synchronously right after `sendMail()` starts, before the stub saw a connection.
- Follow TDD, hand-written stubs, no mocks of Node modules, no real clock; `npm run check` must pass.

## Derived acceptance check
In `notify`, with `npm run check` green:
- New test, silent stub: start `sendMail`, abort immediately; rejects `/aborted/`; after a wait (stub-side, event-based or bounded poll, not a fixed sleep if avoidable) the stub has zero open sockets, and no connection was accepted after the abort.
- New test, accepting stub: same abort; rejects; stub received no message (delivered count 0) and zero open sockets.
- New test: signal already aborted before the call, and a timeout fired before the connection exists, give the same result (no connection, nothing delivered).
- The new tests fail on current `main` (reproduces `deliveredAfterAbort: 1` and the open socket) and pass after the fix.
- Existing abort/timeout tests stay green.
