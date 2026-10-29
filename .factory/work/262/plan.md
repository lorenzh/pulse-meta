# Spec: status follow-up fixes to #256 (issue #262)

## Goal
Fix three P2 errors and one P3 doc gap found in the review of lorenzh/pulse-status#33 (feature #256), in `status` only.

## Scope
`status` repository: `src/metrics.ts`, `src/api-filter.ts`, `src/render.ts`, `src/poller.ts` (comment), `docs/operation.md`, plus tests.

## Non-goals
- No change to contract, api, probe, notify, config.
- No new feature, no new metric, no change to the wire format.
- Removing the placeholders in `poller.ts` is optional; tests must not rely on them.

## Required behavior
1. **Mismatch survives failed polls.** `recordPoll`: `mismatch` sets the flag, `ok` clears it, `error` leaves it. Sequence ok → `/readyz` 200; mismatch → 503 `API version mismatch`; error → still 503 with that reason; ok → 200. The `error` counter still increments.
2. **Allow-list keeps contract-required result fields.** Location entries keep `location`, `checkId`, `statusCode`, `attempts` unchanged from upstream (they carry no target data), in both hide modes, together with the existing fields. Filtered output of every served endpoint must pass the contract validators. `reason` stays sanitized/null in hide mode. Everything else (`secret`, `retries`, `timeoutMs`, unknown future fields) stays dropped. Correct the `poller.ts` comment (~89) that says these fields are never served.
3. **Version error replaces the summary.** `renderSummary` with `error === "version"` and data returns exactly `Status unavailable: versions do not match` (status class `warning`, no incident suffix), before the empty-checks, down, degraded and incident handling. Non-version errors keep today's behavior.
4. **Docs.** `docs/operation.md`: metric outcomes are `ok`, `error`, `mismatch`; replace `Cannot reach the API: <reason>` with the visitor texts already documented (fixed sentences; details go only to the browser console/log). Fix the same stale text in `docs/troubleshooting.md` and README if present.

## Risks
- Exposing `location` names: they are probe location names, not target data, and the validator requires them.
- Tests that assumed the old stripped shape need updating.

## Acceptance evidence
`npm test`, lint and typecheck pass in `status`; new regression tests fail on the old code:
- metrics: the sequence in item 1.
- api-filter: filtered `/api/checks` output for http, keyword, tls and heartbeat checks, in both hide modes, with no placeholders applied, passes the contract `validateResult`/checks validator (also incidents, maintenance, uptime outputs); dropped fields stay dropped.
- render: version error gives the exact text for empty checks, one down check, a degraded check and open incidents.
- docs list `ok`/`error`/`mismatch` and no longer contain `Cannot reach the API: <reason>`.

## Repository: status
Files: `src/metrics.ts`, `src/api-filter.ts`, `src/render.ts`, `src/poller.ts`, `docs/operation.md` (and other stale docs), tests next to them.
Behavior, checks and completion evidence: as in "Required behavior" and "Acceptance evidence" above. The PR closes the child issue.
