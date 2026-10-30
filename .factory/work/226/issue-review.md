# Issue review: #226 Small review leftovers (P3), round 2

The issue is a collection of about 35 independent small fixes (docs, tests, two behavior fixes, two dependency pins) across api, status, probe, notify, contract and meta. It can be specified as is. No item blocks the spec.

## Checked against current `main` of the clones

- api `docs/development.md` ~58 still says the Compose test needs `restart api` and `restart probe`. The item is still open.
- status `package.json` still pins both fontsource packages with `^5.3.0`. Still open. `docs/approved-packages.md` here already says `5.3.0` exact and "status still uses `^`; to be fixed". Remove that remark when the pin lands.
- api pins pulse-contract `c98a2d45`; probe, status and notify pin `cc8c1faa`. Still open. The "current contract main" must be resolved when the plan runs.
- status `docs/configuration.md` line 19 already says `PORT` and `POLL_MS` are validated. This item looks done. The plan should verify and drop it.
- api `grace: null`: the issue itself says #310 resolves it (null is rejected). Only the docs part remains (`docs/configuration.md`).

## Open points (decided in the artifact, none blocking)

1. **Heartbeat deadline (api `src/heartbeat.ts`).** The deadline should start when the evaluator starts, not at the first tick. Assumption: "starts" means construction/start of the evaluator, and `unknown` must end by period+grace after that start. The test must use fake time.
2. **Notify error form (#310 decision 2 conflict).** Two goals conflict: the channel-id form versus the path form. The issue leans to the channel id ("arguably clearer"). Assumption: keep `channel "<id>": smtp.port ...` and document that deliberately in notify docs. If #310 decision 2 names the path form as a hard requirement, the spec states this exception.
3. **Notify reminder duration (`1h` vs `1h 0m`).** The issue allows "accepted or keep". Assumption: accept the kit format (`1h`), document it, and make no code change. This is the cheaper choice and keeps notify on kit.
4. **Reversed maintenance window with a missing note (api `config.ts` ~321).** The issue allows "restore the old order or document it". Assumption: document the new order (note first). Restoring would need the old order to be known, and it is not worth the churn.
5. **Probe missing-header warning.** Log the warning on a 2xx response before body or validation errors propagate. Keep suppression for non-2xx. This is a small behavior change with a test.
6. **Contract own-property.** Required fields must be own properties (an `id` only on the prototype must fail). Document `Number.MAX_SAFE_INTEGER` as the bound of `warnDays`. After the contract change, consumers do not need a pin bump unless noted. The api bump above targets contract main, so it should come after the contract fix if the fix is meant to reach api. Assumption: pin to contract main at build time. Order: contract first, then the api bump.
7. **Public `/api/checks` shape.** Document that it is intentionally not a full `CheckWithState`, and that the browser validates with placeholders for hidden fields. This replaces the contradictory "validate without placeholders" criterion of #262.
8. **Ledger/lock tests in notify.** Inject the failures at the real points: a failed rewrite after the rename, and marker cleanup after acquisition. Each test must fail on the pre-fix code. Ideally verify this by reverting the fix locally.
9. **Several tests must fail on old code** (status poller, status heartbeat card, status mismatch-forwarding, status zod 404 positive control, probe scheduler wiring, api incidents and quorum tests). Acceptance for each is "fails without the fix". The spec should name how to prove it (stash the fix, run, restore).
10. **Probe scheduler wiring test.** It must exercise the `main.ts` clock wiring, not an injected monotonic `now`. If `main.ts` is not testable, extract the wiring into a small function. Allowed, with no behavior change.
11. **Wording for docs that quote validator messages.** Use the actual current messages: probe `must be an integer 1..2147483647`, notify `PULSE_NOTIFY_RETRY_ATTEMPTS: must be an integer >= 0`. Also document the enforced bounds, and that out-of-range checks are skipped. The spec reads the real messages from the code.
12. **Status `README.md` ~49.** An out-of-range `intervalMs` does not fail the refresh, because the proxy drops that field. Only retained fields are validated.
13. **api `docs/rest-api.md` ~128.** Replace "at most the number of locations" with the true bound. Retried submissions can store several rows per location and timestamp (5 rows for limit 1), so the page size is not bounded by the location count.
14. **api SIGTERM test and token-path errors.** Bound the wait, reject on child exit, clean up the child. Token validation errors name the tokens file path and the key (decision 6).
15. **Probe docs.** Show the literal health bind-error message. Take the text from `src/`.
16. **`compose-e2e.sh` `notify_has`.** Anchor the match (for example `grep -Fx` on a whole line, or a `(^|[^0-9])2:opened` pattern).
17. **Status test XML checker.** Use `Map` or `Object.create(null)` so duplicate `__proto__` attributes are detected.
18. **Status malformed upstream URL test.** Send a raw `GET http://[ HTTP/1.1` through a socket so the `handle(...).catch` path is reached.

## Scope and structure

- The work is not in this repo. Per `AGENTS.md`, it fans out to child issues. The targets are `api`, `status`, `probe`, `notify`, `contract` (and `meta` for `docs/approved-packages.md` only). `kit` and `config` are not touched.
- Dependencies for `targets.json`: `contract` first. `api` depends on `contract` for the pin bump. The other targets do not depend on each other.
- Only `docs/approved-packages.md` in meta changes. This is a spec-PR-side or tiny meta change, not a target.
- No new runtime dependencies. Fontsource versions stay `5.3.0`, only the range is removed.
- Public repo: no secrets in the docs examples.

## Assumptions

- Items already done on `main` (status PORT/POLL_MS docs, `grace: null` code change) are skipped. The plan re-verifies each at its start and records the result.
- Line numbers in the issue are approximate. The plan locates the code by content.
- Tests are not expected to be added where the issue only asks for docs.

## Derived acceptance check

Done when, for every item still open on `main` of its target:
1. The docs say what the code does (messages, bounds, ledger rule, rest-api page bound, operation docs, configuration docs, health bind error, test description of the e2e restart).
2. Each named test fails on the pre-fix source and passes on the fixed source.
3. Behavior fixes hold: the heartbeat deadline starts at evaluator start, the probe warns on a 2xx without the header before a body error, contract rejects prototype-only required fields, and the api token errors include path and key.
4. Fontsource pins are exact `5.3.0`, api pins the same contract SHA as the other services (or a newer one that all use), and `npx factory validate` and each target's own checks pass.
