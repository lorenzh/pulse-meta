# Issue review: #433 Small review leftovers (P3), round 5

No blocking questions. Two test-only changes; no product code, no dependencies.

## Current state (checked in clones)
- contract `test/validate.test.ts`: line ~467 "a header reference that exists only on the prototype is rejected" (inherited `env`, expects `ok === false`); line ~475 "an own header reference is accepted" (own `{ env: "TOKEN" }`, expects `ok === true`). The accepted-case alone passes on the old code too.
- probe `src/buffer.test.ts`: line ~153 "an evicted in-flight head that fails is counted once as buffer_full". It asserts `t.drops` only after `t.release()`. The held POST is released after the second submit.

## Open points / assumptions
- contract: "combine" is read as one test that checks both an own reference (accepted) and an inherited reference (rejected), e.g. in a single input with two headers, or in two validations in one test. The test must fail against the pre-fix validator. Assumption: the old code read header refs through the prototype, so the inherited case was wrongly accepted. The implementer should confirm by reverting the fix locally. Keeping the own-reference positive check is fine. Do not weaken the existing inherited-only test unless it is fully replaced.
- probe: add `assert.deepEqual(t.drops, [])` after the second `submit` and before `t.state.isHeld = false` / `t.release()`. This shows the eviction of the in-flight head is not counted as a drop until the POST result is known. Final `assert.deepEqual(t.drops, ["buffer_full"])` stays. Assumption: `drops` is empty at that point on current main. If it is not, the feature turns into a behavior question and should go back for a decision.
- Test-only: no change to `src/` or schema. Each target gets one child issue; no `dependsOn` between contract and probe is needed, since the two changes are independent.
- Other targets (api, status, notify, config, kit, website): no change.

## Acceptance check
- contract: `npm test` passes; the combined header-reference test fails when the inherited-reference fix is reverted.
- probe: `npm test` passes; the new `drops` equals `[]` assertion sits before the held POST is released; the test still ends with `["buffer_full"]`.
- Lint and typecheck pass in both targets.
