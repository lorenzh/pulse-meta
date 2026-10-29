# Issue review #277: contract on zod

Verified against the clones: contract has no runtime deps and hand-written `src/validate.ts` (340 lines); probe `reload-interval.ts` has only a minimum (5000); api `config.ts` `parseInstant` uses `Date.parse` after a regex (rolls over 02-30); api `server.ts` has fixed `MAX_FUTURE_SKEW_MS = 60_000`; status `server.ts` serves a fixed set of contract files (`index.js`, `validate.js`, `version.js`) under `/pulse-contract/` with CSP `script-src 'self'`.

## Open points (for the plan; none blocks)
- Status browser bundle: the allow-list serves only 3 contract files and rewrites the import. If the browser imports `validate.js`, zod must be served same-origin too (new route/allow-list for the zod ESM files, import map or rewrite), or `zod/mini` chosen. Plan must check what the browser actually imports and decide.
- Exact per-field ranges: "documented ranges" are in contract docs/README; the plan must list them (retries 0-10, retryDelayMs 0-60000, port 1-65535, warnDays, timeoutMs, latencyObjectiveMs, uptime 0-100) and the caps (2147483647) in one table.
- Compatibility of the validator API (`{ ok, value | error }`, path-named error strings, extra fields kept i.e. passthrough/loose objects, `Object.hasOwn` semantics vs zod prototype handling). Error message format will change with zod; the plan must define a stable path formatter and update consumer tests that match messages.
- Zod 4 and TS 7 / `z.infer` output in `dist/*.d.ts`: committed dist must match the build; check that d.ts doesn't leak zod types awkwardly for consumers.
- Calendar-date check: define which fields (date-only `YYYY-MM-DD`, ISO instants) and the shared algorithm; api must reimplement it (no contract dependency assumption) or use the contract's helper if api already depends on it.
- Skew limit: "at most one interval, at most 60 s" = min(intervalMs, 60000) of the check for the token; heartbeat checks and unknown check ids need a defined fallback (assume 60 s).
- Probe: reload env upper bound = 2147483647; startup error message must name `PULSE_CHECKS_RELOAD_MS`. Scheduler/reloader use-site cap: assume clamp to the max (and reject at settings).
- Existing deployed checks files with out-of-range values will now be rejected; assume acceptable (documented in each repo).
- Ordering: contract merge, then status/probe/notify bump pin (parallel), api last. Each consumer pins the merged contract commit, so child issues depend on the contract; fan-out `dependsOn` must reflect this.
- Notify and config targets: notify only bumps; `config`/`kit` untouched (kit and S2/S5 are non-goals).

## Assumptions
- Zod pinned exactly (4.x latest at plan time); wire format, `WIRE_VERSION`, header unchanged.
- Package registry access for zod is fine in all repos (public npm).

## Acceptance check
With the merged contract pinned in status, probe, notify and api: a check with `intervalMs` 2147483648, `retries` 11, uptime 101 or date `2030-02-30`, or a maintenance window with end <= start, is rejected by contract and api with a path-named error; `PULSE_CHECKS_RELOAD_MS=3000000000` fails probe startup naming the variable; an api push for a 10 s check with a timestamp 30 s ahead is rejected; status still renders in the browser with CSP intact; all repo tests (each new one failing on old code) and `compose-e2e` pass.
