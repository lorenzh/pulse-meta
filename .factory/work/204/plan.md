# Spec #204: Probe accepts checks with an empty url or host again

## Goal
The probe skips an HTTP check with `url: ""` and a TLS check with `host: ""`, and logs a line naming the check id, as before #195.

## Decision
Non-empty `url` and `host` belong in the contract validator (option A of the issue review). The api already guarantees both (`api/src/config.ts`), so this is a wire-level invariant, not a new rule. The probe then needs no rule of its own, only a new contract pin and a log line that names the id. No probe-own duplicate guard.

## Scope
- contract: `url` (http check) and `host` (tls check) become `required(nonEmpty)` in `src/validate.ts`.
- probe: bump the contract pin; the skip log names the check id; regression tests.

## Non-goals
- Whitespace-only values, malformed URLs and host syntax (scheme, port, path) are not validated in the contract. Only the empty string is in scope. The api keeps its stricter rules.
- No wire version bump: conforming producers (the api) already comply.
- No change in api, status, notify, config. Their tests only use empty url/host as intentionally invalid input (api) or for unrelated fields (notify fake servers); the targets run their checks against the new contract only when they bump the pin, which this spec does not require.

## Required behavior
- `validateCheck` (and every validator that reuses `httpShape` / `tlsShape`, such as the checks list and checks with state) rejects `url: ""` and `host: ""` with the usual error naming the path, e.g. `checks[1].url: must be a non-empty string`. Non-empty values still pass.
- probe `loadChecks`: an invalid check is skipped and the other checks stay. The log line names the check id when `raw` is an object with a string `id`, e.g. `skipping invalid check <id>: <error>`. Without a readable id it falls back to the path only, as today.

## Risks
- Contract consumers that pin a newer contract will start rejecting empty values. The api never serves them, so impact is nil for conforming data.
- The probe tests must use the new contract pin, otherwise they pass for the wrong reason or fail. The pin must be a commit SHA on the contract's main after the change is merged.

## Acceptance evidence
- `/checks` returns a valid check, an HTTP check with `url: ""` and a TLS check with `host: ""`: the probe schedules only the valid check and logs one skip line per invalid check naming its id.
- The probe regression tests for both cases fail on the previous code and pass now.
- Contract tests reject `url: ""` and `host: ""` and accept non-empty values.

## Repository: contract
- Files: `src/validate.ts` (`httpShape.url`, `tlsShape.host` use `required(nonEmpty)`), the validation tests (`url: ""` and `host: ""` are rejected for `validateCheck`, and for a checks list and checks with state if those validators exist; non-empty values are accepted). Update docs or comments of `Check` fields in `src/index.ts` and the README if they describe the fields (say "non-empty").
- No wire version bump.
- Done when: the contract's tests, lint and build pass, and the change is on main as a commit that the probe can pin.

## Repository: probe
- Depends on contract. Set `@lorenzh/pulse-contract` in `package.json` and the lockfile to the SHA of the contract commit from this spec.
- `src/client.ts` `loadChecks`: include the id in the skip log (`skipping invalid check <id>: <error>`) when readable; no probe-own url/host rule.
- Regression tests in the client tests: `/checks` returns a valid check, an HTTP check with `url: ""` and a TLS check with `host: ""`. Assert that only the valid check is returned and that one log line per invalid check names its id. Tests fail on the code before this change.
- Done when: the probe's tests, lint and build pass with the new pin.
