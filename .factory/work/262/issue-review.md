# Issue review: #262 (follow-up fixes to #256, target `status` only)

Verified against `.repos/status` and `.repos/contract`.

## Findings (all confirmed in current code)
1. `metrics.ts` `recordPoll`: `isMismatched = outcome === "mismatch"` clears the flag on `"error"` (and on `"ok"`, which is correct). Fix: set true on `mismatch`, clear only on `ok`.
2. `api-filter.ts` `RESULT_FIELDS = timestamp,status,latencyMs`; `cleanLocation` keeps only `stale` + result. Contract `validate.ts` (~152-159, ~195-198) requires result `checkId`, `statusCode` (nullable), `attempts`, `location`. `poller.ts` `withTargetPlaceholder`/`fillLocations` hides this with placeholders (`statusCode: null, attempts: 1, location: ""`).
3. `render.ts` `renderSummary`: the `checks.length === 0` return and the down/degraded branches precede the `error === "version"` text.
4. `docs/operation.md`: line 29 lists outcomes `ok`/`error` only; "Cannot reach the API: <reason>" in line 67 (line 81 already documents the new texts).

## Open points / assumptions (none blocks the spec)
- Item 2 scope: keep `location`, `checkId`, `statusCode`, `attempts` on location results, values unchanged from upstream (they are not target data). Assumption: `location` is a probe location name, treated as non-secret as the issue says; the #256 plan said to drop names unless required, and the validator requires it. Also keep required fields of other served shapes that the validator needs (check incidents, maintenance `checkId`, uptime) — the test should validate every served endpoint, not only locations.
- Hide mode: `statusCode` is not target text; keep unchanged in both modes. `reason` stays sanitized/null.
- Placeholders in `poller.ts` may remain as a defensive fallback; the comment at poller.ts ~89 saying these fields "are never served" must be corrected. Removing the placeholders is optional; tests must not depend on them.
- Item 1 semantic: readiness stays 503 "API version mismatch" through `error` outcomes until the next `ok`. The `error` counter still increments. A `mismatch` after `ok` makes it unready regardless of `lastSuccessMs` age.
- Item 3 precedence: version error wins over empty checks, down, degraded and open-incident suffix. The summary text is exactly `Status unavailable: versions do not match` (no ` · N incident open` suffix; assumption). Status class stays `warning`. Non-version errors keep today's behavior (down/degraded win over "Status may be outdated").
- Item 3 empty checks with a version error and data: also the version text, not "No checks configured".
- Item 4: document outcomes `ok`, `error`, `mismatch`; replace `Cannot reach the API: <reason>` with the texts in line 81 and say details go to the browser console / log only. Check `docs/troubleshooting.md` and README for the same stale text.
- No contract/api/probe/notify/config change; no new feature dependency (builds on merged #256).

## Acceptance check
In `status`: `npm test`, lint and typecheck pass, and new regression tests fail on the old code:
- metrics: ok → ready; mismatch → `/readyz` 503 "API version mismatch"; error → still 503 with that reason; ok → 200.
- api-filter: filtered `/api/checks` output (http, keyword, tls, heartbeat; both hide modes), with no placeholders applied, passes the contract `validateResult`/checks validator, and still drops `secret`, `retries`, `timeoutMs`, `futureField` etc.
- render: `renderSummary` with `error = "version"` returns `Status unavailable: versions do not match` for empty checks, one down check, a degraded check, and open incidents.
- `docs/operation.md` lists `ok`/`error`/`mismatch` and no longer shows `Cannot reach the API: <reason>`.
