# Issue review: #647

## Disposition

Ready for `plan`. No question requires a `needs-input` hold. The overflow policy and counting interpretation below are explicit review assumptions for the planner, not decisions found in issue comments.

## Sources and current behavior

- Read meta `AGENTS.md`, `README.md`, Factory preamble and issue-review prompt, and probe `AGENTS.md`. Read [#647 and all its comments](https://github.com/lorenzh/pulse-meta/issues/647): the only comment is the current Factory claim; there are no earlier product decisions.
- Inspected the read-only probe clone at `89f12324a6e77d5a716beacc22e178b8e1112284`, the merge of [probe PR #52](https://github.com/lorenzh/pulse-probe/pull/52). The prerequisite implementation from #557 / child #645 is already present. Also read the earlier skip-warning section in `.factory/work/557/plan.md` and #645's comments. This issue supersedes the reset behavior accepted during that work; it does not reopen its scheduler, retry, buffer or cancellation changes.
- Probe `src/client.ts:176–207` uses a `WeakMap` keyed by the injected `log` function. Each value is a set of at most 10,000 keys. Readable string IDs become SHA-256 hex digests using the default UTF-8 encoding; records without a readable string ID use `null`. For an unseen key when full, the code clears the entire set, inserts the key and logs the detailed skip line. There is no overflow diagnostic today.
- Both invalid contract records (`logInvalid`) and missing/invalid header-env skips (`withResolvedHeaders`) use this state. `main.ts:130–175` shares one `log` across startup and subsequent reloads. Heartbeats are silently dropped; host-binding denials are separate diagnostics for checks that run and report down.
- `src/client.test.ts:741–844` already covers repeated loads, recovery, changed rejection reasons, reordered records, shared ID-less fallback, fresh logger state, secret-free logs and long-ID retained memory. It lacks the 10,001-ID reload regression and lone-surrogate regression.
- The reset text occurs in probe `README.md:5`, `docs/configuration.md:39,100` and `docs/troubleshooting.md:62`. These requested documentation paths belong to probe, not meta. No target other than probe needs implementation changes.

## Open points and assumptions

1. **Overflow policy must prevent cycling.** The suggested oldest-key eviction is illustrative, not sufficient acceptance behavior. With 10,001 IDs in the same order, a 10,000-entry FIFO cache evicts the next needed key continually and still logs every ID on every reload. Clearing has the same outcome. Prefer saturation: retain the first 10,000 warning keys without clearing or evicting them; on the first additional unseen key, emit one overflow warning and suppress detailed warnings for untracked keys for that logger's remaining lifetime. Keep only bounded digest state plus a constant-size overflow flag. Recovered checks still become runnable, and an empty or changed response does not reset warning state.

2. **Separate detailed warnings from the overflow line in counts.** The issue's expected `[10001, 0, 0]` is interpreted as total skip-related warning lines under saturation: 10,000 detailed first-time warnings plus one overflow line on the first load, zero on the next two. It is not a demand to retain and individually warn for arbitrarily many distinct IDs forever with only 10,000 keys. The tradeoff is that previously unseen IDs after saturation receive no detailed warning until a fresh logger/process. The plan and docs must state this explicitly. If the planner selects another bounded strategy, it must explain how it avoids the FIFO counterexample and define its exact detailed/overflow counts.

3. **Threshold and lifetime.** Reaching exactly 10,000 retained keys is not itself overflow; encountering another unseen key triggers it. Repeated known keys at capacity stay quiet. “Once” means once per injected logger identity, including startup and every later reload, rather than once per response, endpoint, rejection reason or overflow episode. A fresh logger starts with fresh state. Preserve `null` as a distinct shared key for unreadable IDs; it counts toward the same 10,000-key limit. ID-less records do not become separate identities.

4. **String identity before hashing.** Use the exact JavaScript UTF-16 code-unit sequence, for example SHA-256 with explicit `utf16le` input encoding. Do not normalize, repair lone surrogates, iterate only Unicode scalar values, or retain raw IDs as cache keys. Keep the fixed digest size. “Distinct IDs” addresses the deterministic UTF-8 replacement collision, not mathematical collision freedom for a finite hash. The `null` sentinel must remain distinct from every string, including an empty string or a string resembling a sentinel.

5. **Logging-only scope.** Continue validation and header resolution on every reload, even after saturation. Preserve which checks are skipped or returned, HTTP request/fallback behavior, heartbeat silence, host-binding denial diagnostics and other warning classes. Share keys across both skip paths as today. Add no environment variable, dependency, wire-contract or API change. Overflow text should explain that further individual skip warnings are suppressed until restart; it must not include raw payloads, header values, bodies or tokens. Exact wording is a plan choice.

## Derived acceptance check

Tests should exercise exported `loadChecks` using injected fetch and one stable logger, with the correct wire-version header so unrelated warnings cannot affect counts. Use small invalid records with distinct readable IDs, keeping the response below the existing 5 MiB body cap. Cover these observable outcomes:

| Check | Required result under the recommended policy |
| --- | --- |
| 10,001 rejected IDs, same response over three loads | Per-load total warning counts are `[10001, 0, 0]`: 10,000 detailed skip lines and exactly one separately identified overflow line overall. No detailed ID appears twice. Rejected checks are absent on all loads. |
| Capacity boundary | 10,000 distinct rejected IDs yield 10,000 detailed lines and no overflow; another load of them adds nothing. A later new rejected ID yields one overflow line only. Further unseen IDs and repeated over-capacity responses add nothing. |
| Recovery after saturation | Include a valid control in the oversized list and return it on every load. Correct a previously rejected check and verify it is returned; reject it again and keep warnings suppressed. Changed/reordered/empty lists do not reset overflow state. |
| Logger lifetime | A fresh logger produces its own initial detailed warnings and one overflow line when its own capacity is exceeded. Reloads using the original logger remain quiet. |
| UTF-16 regression | In a fresh scope, load rejected records whose IDs are `"\ud800"` and `"\ud801"`. Capture two distinct detailed skip lines; loading them again adds zero. These must be malformed records with readable string IDs, rather than input rejected before the skip logger is reached. |
| Existing skip semantics | Retain the existing invalid/header-env shared-ID, reason-change, ID-less fallback, recovery and fresh-logger coverage. Heartbeats and host-denial diagnostics retain their existing behavior. No secret sentinel appears in detailed or overflow logs. |
| Bounded memory | Retain the long-ID memory regression. Inspect the implementation to confirm at most 10,000 fixed-size retained digest/sentinel keys plus constant-size state, no growing secondary cache, and no retained raw IDs or payloads. The overflow regression must not be fixed by removing the cap. |
| Documentation | Update every reset reference in the three probe files. Explain the bound, one overflow diagnostic, suppression after saturation, restart behavior and continued validation/recovery. Do not promise unlimited per-ID first-time logging beyond capacity. |

Implementation handoff should show the two new defect regressions fail against the current code and pass with the fix, then run probe's required `bun run check` and the local runtime exercise required by its `AGENTS.md`. Keep this follow-up limited to warning behavior; do not import unrelated rollout gates from #557.

## Review verification

No product code or read-only clone was changed. A small Node algorithm reproduction of the inspected clear-all branch produced `[10001,10001,10001]`; replacing clear-all with FIFO produced the same counts while retaining 10,000 keys. A Node crypto check confirmed that the two lone-surrogate IDs have equal UTF-8 SHA-256 digests and unequal UTF-16LE digests, both 64 hex characters. These were isolated algorithm/encoding checks, not execution of the probe test suite. Product tests were not run during issue review; probe dependencies are not installed in the clone.
