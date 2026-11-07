# Issue review #824: service report heartbeat cadence

## Disposition

Ready for `plan`. No question requires a `needs-input` hold. This is a notify-only
correction to the reporting loop delivered by #570 / child #810; do not rebuild that
feature or change another target.

## Evidence inspected

- Read meta's `AGENTS.md`, `README.md`, and `.factory/prompts/issue-review.md`, plus
  notify's `AGENTS.md` and `package.json`.
- Read [issue #824 and its comments](https://github.com/lorenzh/pulse-meta/issues/824).
  The only comment is the current Factory claim; there are no earlier decisions.
- [pulse-notify PR #47](https://github.com/lorenzh/pulse-notify/pull/47) is merged
  (merge commit `0464b90c0ebfe52fe8ca918e7362677ed366b034`). Its issue conversation
  has no comments. The prerequisite behavior is present in the local notify clone,
  inspected at `5a44c5a3de1764faa04b6cd3762f2c2be4c58430`.
- `.factory/work/570/plan.md`, Decision 5, requires a report after every apply
  attempt and at least every 60 seconds. Its notify section retains that decision.
- `.repos/notify/src/index.ts:840` (`startChannelLoop`) runs a channel poll followed
  by a report in `cycle()`. `nextBeat()` starts a separate report and rearms its
  60,000 ms timeout inside the report's `finally`. A 4,000 ms heartbeat request
  therefore adds 4,000 ms to the next start gap. This confirms the issue's cause
  by inspection; no injected-clock reproduction was run during issue review.
- The same function has no shared report-in-flight guard: poll reports and beat
  reports can overlap. `beats` tracks heartbeat promises for shutdown; it does
  not serialize them with `cycle()`.
- `stop()` cancels both pending timers and awaits `running` and `beats`. `main()`
  awaits the channel loop before stopping the notifier, flushing/closing the
  ledger, and releasing its lock. Preserve that lifecycle.
- Existing coverage includes `test/channel-loop.review.test.ts` (shutdown waits
  for an in-flight beat) and `test/index.test.ts` (poll and beat reports, timer
  cancellation, and zero service calls without a token). The latter fires timers
  by delay with a constant clock; it does not establish elapsed-time cadence.
- `MainDeps` already injects `now`, `channelSchedule`, and `serviceFetch`.
  `src/api.ts` sends reports through `sendService` with a 5,000 ms service timeout;
  `ServiceOptions.schedule` supports an injected request timer, although
  `createChannelSync` currently does not wire that option from `MainDeps`.

## Open points and assumptions for the spec

1. **Meaning of the bound.** Measure request starts, not response completion or
   receipt by the API. With timely fake timer dispatch and request duration below
   60 seconds, heartbeat starts must retain the 60,000 ms cadence regardless of
   request latency. This is not a guarantee against event-loop stalls or a frozen
   clock in production.
2. **Requests spanning a tick.** An unconditional maximum 60-second gap conflicts
   with the explicit no-overlap constraint for requests lasting longer than a
   tick. Apply the issue's stated exception: skip or wait when a report is still
   in flight, then resume reporting after it settles. The plan must choose and
   document one policy, including recovery without a burst of catch-up requests.
   Both policies are authorized by the issue, so this does not require a hold.
3. **All report producers share serialization.** The no-overlap rule covers
   heartbeat-versus-heartbeat and heartbeat-versus-poll reports. Preserve a report
   after every completed channel apply attempt, including unchanged or rejected
   polls; a collision may wait for the current report. Do not silently lose the
   feedback for an apply attempt. Build a deferred report from the then-current
   state, avoiding an older queued snapshot overwriting newer feedback.
4. **Independent heartbeat.** Keep the immediate startup poll/report and the
   first heartbeat at 60,000 ms. Keep heartbeat timing independent of poll
   completion; ordinary poll reports remain additional feedback. No poll cadence,
   timeout, payload, endpoint, auth, or ledger change is requested. Tokenless mode
   continues to make no service reports. The state-lock heartbeat is separate.
5. **Shutdown and failures.** Preserve waiting for in-flight reporting rather
   than introducing a new abort contract. Cancel the pending heartbeat even when
   it is armed while another report runs. Stop must also track any report waiting
   behind another report and prevent it from starting after shutdown begins.
   Completion or failure during shutdown must not rearm a timer. A failed report
   must release serialization and allow later scheduled reporting.
6. **Test placement and scope.** Add regression coverage through exported `main`
   using the existing dependency seams, under `test/` as notify's repository-
   specific instructions require. No new runtime dependency or shared-library
   change is indicated. A test that holds a request across a tick must account
   for the existing service timeout; do not change production timeout behavior
   merely to construct that case. Keep request-timer behavior deterministic if
   the test exercises it.

## Derived acceptance check

1. In notify, use a chronological fake scheduler, injected `now` and fetch, an
   isolated temporary ledger, a fake notifier, and a service token. Set
   `PULSE_NOTIFY_CHANNELS_POLL_MS=300000`. Fake channel reads answer immediately;
   capture the fake time at entry to each `PUT /service/notify/report` fetch.
   Stub or control the command and state-lock timers as well. No external network
   or wall-clock sleeps are needed.
2. Run both zero-latency and 4,000 ms report-latency cases. Advance through at
   least 180,000 ms, processing deadlines and async continuations at their actual
   fake times. The report starts must be `[0, 60000, 120000, 180000]` in both cases;
   every adjacent gap is at most 60,000 ms. Assert the count as well as the gaps
   so a missing report cannot pass. Keep the delayed response separate from timer
   advancement so awaiting a fake callback does not serialize the clock itself.
3. Demonstrate red/green in the notify implementation: the old code passes the
   zero-latency control but fails the delayed case (its starts drift to 124,000 ms
   for the third report); the fix passes both. Record the commands and outcomes.
4. Hold a report across a heartbeat tick and separately arrange a poll report to
   collide with a heartbeat. Assert at most one report request in flight,
   eventual reporting after release according to the chosen skip/wait policy,
   and preservation of poll feedback. Also verify a failed report does not
   permanently block the next heartbeat.
5. Stop once with only a pending timer and once during a delayed report. Pending
   callbacks produce no later report; stop waits for the active report; releasing
   it completes shutdown without rearming. Exercise shutdown with a deferred
   collision as well if the implementation queues reports. Retain the existing
   in-flight shutdown and tokenless tests.
6. Keep report shape, endpoint, ledger format, channel polling, and report-after-
   apply behavior intact. Existing report validation and integration coverage
   should continue passing. Run `bun run check` in the notify implementation
   checkout, with its existing coverage and lint limits unchanged.

This state writes only this review artifact in meta. Notify source changes and
red/green execution belong to the later target build; no product checks have
been claimed here.
