# Spec: Small review leftovers (P3), round 5 (#433)

## Goal
Tighten two tests so they fail on the old code. Test-only.

## Scope
- contract: `test/validate.test.ts`.
- probe: `src/buffer.test.ts`.

## Non-goals
No change to `src/`, schema or dependencies. No other target changes.

## Risks
- If `t.drops` is not `[]` at the new probe assertion on current main, that is a behavior question: stop and ask for a decision.
- The old-code assumption for contract (header refs read through the prototype) must be confirmed by reverting the fix locally.

## Performance impact
none expected: test-only changes, no runtime code.

## Repository: contract
- In `test/validate.test.ts` (~467-480), merge "a header reference that exists only on the prototype is rejected" and "an own header reference is accepted" into one test. It checks an own reference (`{ env: "TOKEN" }`, `ok === true`) and an inherited one (`Object.create({ env: "TOKEN" })`, `ok === false`), e.g. two validations in one test. Replace both old tests; do not weaken coverage.
- Check: `npm test`, lint and typecheck pass. With the inherited-reference fix reverted locally, the combined test fails.
- Evidence: PR notes which revert was tried and the failure seen.

## Repository: probe
- In `src/buffer.test.ts` (~153) test "an evicted in-flight head that fails is counted once as buffer_full": add `assert.deepEqual(t.drops, [])` after the second `submit` and before `t.state.isHeld = false` / `t.release()`. Keep the final `assert.deepEqual(t.drops, ["buffer_full"])`.
- Check: `npm test`, lint and typecheck pass.
- Evidence: the new assertion sits before the release; the test still ends with `["buffer_full"]`.
