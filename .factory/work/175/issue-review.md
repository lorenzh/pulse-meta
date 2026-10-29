# Issue review #175: out-of-range timestamp keeps the event queued

Verified against `notify` main (`src/notifier.ts`, `src/api.ts`).

## Current behavior
- `src/api.ts` (~l.42-54) validates `openedAt`/`resolvedAt` with `Number.isFinite` only. `1.8e18` passes.
- `#pollChannel` (~l.244) calls `channel.queued.add(key)` before `buildNotification(...)`. `buildNotification` (~l.62-77) calls `new Date(timeMs).toISOString()`, which throws `RangeError` for |ms| > 8.64e15.
- The key stays in `queued` and is never released, so later polls skip it, even once the API corrects the timestamp. This contradicts spec #165 decision 3.
- The same order (`queued.add` then `buildNotification`) exists in `#rebuildLegacyPending` (~l.274). It is fed by already validated incidents, so the same bad timestamp reaches it.

## Open points (none blocks the spec)
1. Exact range check: the plan picks it. Suggested: `Number.isFinite(v) && Math.abs(v) <= 8.64e15`, or `!Number.isNaN(new Date(v).getTime())`. Reason text e.g. "openedAt is not a valid date".
2. Unit of `openedAt`/`resolvedAt`: milliseconds (taken from `new Date(timeMs)`); the plan confirms against the contract.
3. Build-before-queue must hold at every site that enqueues (`#pollChannel`, `#rebuildLegacyPending`). If building throws anyway, catch, log with channel and key, and leave the key unqueued. Defense in depth, not only validation.
4. Where the throw lands today: `tick()` must never reject (spec #165 decision 4). The plan checks that a throw during build is caught, and that other incidents of the poll and other channels are still processed.
5. Log dedupe: the log is once per incident id per process (decision 3). After the API corrects the timestamp the event is delivered. Does a repeat of the bad value log again? Assumption: no.
6. Docs: `docs/operation.md` malformed-data text should mention out-of-range timestamps, if it lists the checks.

## Assumptions
- Only `notify` changes. No contract, API, key format or ledger format change.
- Incident `resolvedAt` gets the same range check as `openedAt`.
- A bad incident creates no ledger entry and is re-evaluated each poll.

## Acceptance check
Regression test in `notify` (it must fail on current main):
- Poll 1: API returns incident A with `openedAt: 1.8e18` and incident B valid. An error log names incident A. B is delivered. Nothing is delivered for A. No rejection (`unhandledRejection` listener sees none).
- Poll 2: API returns A with a valid `openedAt`. A's `opened` event is delivered once, with the key `<A>:opened`.
- Also a unit test for the validator: `1.8e18`, `-1.8e18`, `8.64e15 + 1` are rejected; `8.64e15` and `0` are accepted.
- `npm run check` passes.
