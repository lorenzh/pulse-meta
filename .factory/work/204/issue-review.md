# Issue review: #204 Probe accepts checks with an empty url or host again

## Verified current state
- `probe/src/client.ts` `loadChecks` runs `validateCheck(raw, "checks[i]")` from the contract. On failure it logs `skipping invalid check: <error>` and skips; otherwise it keeps the check. No probe-own rule remains.
- `contract/src/validate.ts`: `httpShape.url` and `tlsShape.host` use `required(text)` (any string, so `""` passes). `id` already uses `nonEmpty`, and a `nonEmpty` rule exists.
- `api/src/config.ts` already rejects an empty `url` (non-empty, parseable, http/https) and an invalid `host` (non-empty, no scheme, port or path). So the api never serves such checks. The regression only matters against a non-conforming API or a stale one.
- The probe pins the contract by commit SHA in `package.json`, so a contract change needs a new pin in the probe (and in any other consumer that should pick it up).

## Open points (none blocks the spec)
1. Where the rule belongs (the issue asks the plan to decide). Options:
   - A: contract `url` and `host` become `required(nonEmpty)`. This is the wire-level invariant that the api enforces. The probe then needs no extra code, but must bump its pin and add regression tests. Other consumers (api, status, notify) that use `validateCheck`/`validateChecksResponse` also start rejecting empty values. Check their fixtures and tests.
   - B: a probe-own rule only, as the #195 plan said (the probe keeps its extra rules on top of the contract). Smaller blast radius, no cross-repo dependency.
   - A and B together: contract plus a probe guard. This is redundant, so avoid it unless a pin bump must be decoupled.
   - Recommendation for the plan: A, since the api already guarantees it, and also pin the probe. If the contract cannot ship first, B is the fallback. Either way the probe tests must pass.
2. Whitespace-only values (`" "`) and a malformed URL or host are not covered by the issue. Assumption: only the empty string is in scope. Do not copy the full api rules into the contract.
3. Which contract validators change: `validateCheck` is shared by the single-check, checks-list and checks-with-state shapes. Confirm that `CheckWithState` reuses `httpShape`/`tlsShape`, so the rule applies there too. Contract also needs its own tests and possibly a wire/version note. Whether this is a breaking change for the wire version is for the plan to decide. Assumption: no version bump, since conforming producers already comply.
4. `dependsOn` order if A: contract first, then probe (pin bump plus tests). Other targets change only if their tests or fixtures use an empty url/host.
5. Log line: "naming the id". The contract error currently names the path (`checks[3].url`), not the check id. Under A the existing log would not name the id. The plan must make the probe log include the check id when it is readable (for example `skipping invalid check <id>: <error>`), or settle for the path and say so. Assumption: include the id, as the issue requires.

## Assumptions
- "As before #195" means: skip the check, log a line with its id, and keep the other checks running.
- Regression tests belong in the probe (client tests with `/checks` returning an HTTP check with `url: ""` and a TLS check with `host: ""`), must fail on current `main`, and must assert the log line.

## Derived acceptance check
- With `/checks` returning a valid check, an HTTP check with `url: ""` and a TLS check with `host: ""`: the probe schedules only the valid check, and logs one skip line each for the two invalid checks naming their ids.
- Probe regression tests for both cases fail on current code and pass after the change.
- If the contract changes: contract tests reject `url: ""` and `host: ""` and accept non-empty values. The probe pin points to the new contract commit, and the tests of the other targets using the contract still pass.
