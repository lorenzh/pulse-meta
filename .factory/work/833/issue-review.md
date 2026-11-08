# Issue review: #833

## Disposition

Hold with `needs-input`. The failure and the intended error handling are clear, but the required second `subscribers` command does not exist on the inspected notify base. Choosing a new command or changing invalid-command exit codes would expand the requested fix. Resolve this before writing the spec.

Blocking question: notify currently supports only `subscribers delete <address>`. What should “and one more subscribers command” mean?

1. Recommended: another valid `subscribers delete` invocation, covering a second corrupt-store fixture or an address normalization variant. Keep unsupported commands and invalid arguments at exit 1; add no command.
2. An unsupported invocation such as `subscribers list` should exit 2 when a corrupt file exists. This explicitly relaxes the constraint against changing other exit codes and changes validation/store-access ordering; confirm that scope.
3. A distinct supported subcommand is intended. Name it and supply its behavior, or identify the prerequisite feature that adds it. Adding a command needs an expanded spec or a separate dependency.

All other open points below can be resolved during planning without a hold. The acceptance checks and file scope below describe the narrow fix under answer 1 and must be reconciled if another answer is chosen.

## Evidence inspected

- Read meta `AGENTS.md`, `README.md`, and the `issue-review`/preamble prompts; read notify `AGENTS.md`, `README.md`, relevant portions of `docs/operation.md`, `docs/development.md`, source, tests, and test configuration directly from `.repos/notify/`.
- Notify context HEAD: `3b000f2698c77a1f6cf72d7a8dcd81ecf46b9d7d`. This identifies the inspected snapshot, not the later implementation base. Record the actual implementation base before edits in the build environment.
- Read the live body and all comments of [meta #833](https://github.com/lorenzh/pulse-meta/issues/833). Its only comment at review time is the Factory claim; there is no earlier decision resolving the second-command requirement. The body identifies merged notify #48 / feature #573 / child #820 as the origin; do not redo the subscriptions feature.
- `src/subscribers-cli.ts`: `runSubscribers` accepts exactly `delete` and one address; unsupported arguments return usage/code 1 and invalid addresses return code 1 before acquiring the lock or opening a store. Only `ConfigError` and `StartupError` reach its one-line/code-2 result; other errors are rethrown. Its `finally` closes an assigned store and releases an assigned lock.
- `src/subscriber-store.ts`: `openExisting` returns `undefined` for an absent file, otherwise calls `open`. `open` creates a SQLite connection, applies pragmas and checks `user_version`. A version other than 1 throws `StartupError`; its message names `PULSE_NOTIFY_SUBSCRIPTIONS_STATE`, not the file path. SQLite errors are rethrown after connection cleanup inside the pragma/version block. `new Database` is outside that block. Do not assume all corruption is discovered at the same step.
- `src/index.ts`: `runSubscribersCli` maps code-0 results to stdout and nonzero results to stderr, and only catches the same two error types. The executable's final catch also rethrows other errors. Source inspection supports the reported uncaught-SQLite-error mechanism; this review did not execute the reproduction.
- `test/subscribers-cli.test.ts` covers successful deletion, missing store, held lock, invalid address, unsupported arguments including `list`, and operation with subscriptions off. `test/index.test.ts` covers executable usage/code 1 and lock handling through `runSubscribersCli`. `test/subscriptions-store.test.ts` tests refusal of `user_version=2`; this alone is not evidence of an executable exit code or diagnostic.
- `docs/operation.md#subscriber-store` documents deletion, lock refusal, exit codes and address privacy. Notify `AGENTS.md` requires a README change for behavior changes. Both `README.md` and `docs/operation.md` belong in the implementation scope and its acceptance.

## Nonblocking open points and assumptions

1. **Affected repository:** notify only. No contract, API, status, kit, deploy, or meta product change is needed. No dependency/pin update is justified by this request. This state writes only this retained meta artifact; context repositories remain read-only.
2. **Error boundary:** localize the change to the subscribers CLI boundary. Preserve `SubscriberStore` and service startup behavior. Planning must choose a typed/narrow recognition of corruption/non-database SQLite failures, rather than converting every unexpected exception to exit 2. Cover failures encountered while opening and using the store without moving argument validation or swallowing programming errors. Inspect the installed Bun SQLite types/runtime before choosing the classifier; do not rely solely on matching an arbitrary message.
3. **Diagnostic:** the new corruption result goes through the existing code-2 output path: one nonempty line on stderr, ending in one newline; stdout empty. It identifies the configured store file, does not print the supplied address or any address embedded in corrupt content, and has no stack trace or raw database content. The exact safe wording is a planning choice. “Same path” does not require changing existing unsupported-version wording to include its path.
4. **Privacy/path assumption:** file fixtures use ordinary paths without address text. “Contains no address” means no disclosure of the address argument or stored/corrupt content; it cannot simultaneously prohibit address characters in an operator-chosen path and require that exact path to be printed. Do not echo a raw SQLite message that might contain input values. Keep the one-line guarantee when choosing diagnostic formatting.
5. **Corruption and preservation:** use a deterministic nonempty non-SQLite file (not an empty file, which SQLite can treat differently), preferably containing a private sentinel address, and a second deterministic corruption fixture if answer 1 is selected. A genuinely damaged SQLite fixture is useful if it reliably fails without mutation; specify how it is built. Do not add schema validation, integrity scanning, repair, migration, or database recreation as part of error mapping. Prove byte preservation and lock release after each invocation.
6. **Validation precedence:** valid delete invocations reach store handling. Invalid address/arity/unsupported-command cases remain exit 1 even when a corrupt file is present; a held lock remains exit 2. Missing store remains `deleted 0`/exit 0 with no database created. The second-command question must not silently turn an unsupported command into an exit-2 regression case.
7. **Testing location:** prefer one dedicated new CLI corruption test file using existing public functions and a real executable subprocess. Avoid editing existing suites just to add this topic. Tests must import only names already present on the implementation base so their red evidence is behavioral. Existing helpers may be reused unchanged. Plan the subprocess environment so unrelated inherited settings do not cause an earlier failure.
8. **Performance interpretation:** use five interleaved base/branch pairs (ten measurements, five per revision) to obtain five samples for each revision. Report user+system test CPU, individual values, medians and the branch-minus-base median delta. This conservatively resolves “five interleaved runs” without reducing the evidence. No CPU threshold was supplied; report noise rather than inventing a pass budget. Do not run the Docker bench (#834).

## Proposed implementation Files

For the narrow fix, the plan and each task must agree on the final exact allowed paths, with this proposed set:

- `src/subscribers-cli.ts`: recognize the relevant store failures and return the safe code-2 diagnostic.
- `test/subscribers-cli.corrupt-store.test.ts`: new regression and compatibility controls, including the executable boundary.
- `README.md`: mention corrupt-store CLI refusal and exit 2 beside the subscribers CLI description.
- `docs/operation.md`: document the same refusal, filename diagnostic, privacy, byte preservation and released lock in the subscriber-store operator procedure.

If source inspection during planning requires another path, reconcile it explicitly before implementation. Do not quietly broaden a task. In particular protect `src/subscriber-store.ts`, `src/index.ts`, `src/failed-cli.ts`, settings/configuration modules, existing tests, dependency manifests/lockfile, `AGENTS.md`, Docker/CI and tooling configuration. No change to store format or service startup is authorized by answer 1.

## Derived acceptance checks

### Regression, preservation and output

1. Record actual `BASE` before the first implementation edit. Create temporary independent fixtures and run the real entry point with only the needed store/lock settings, for example `PULSE_NOTIFY_SUBSCRIPTIONS_STATE=<file> bun src/index.ts subscribers delete probe@example.com`. No real API, SMTP service or production data is needed. The real CLI invocation supplies the user-visible smoke exercise required by notify instructions; report its command and outcome without starting an unrelated long-running service.
2. On a non-database file, assert exit 2, empty stdout, and exactly one nonempty stderr diagnostic identifying the file. Assert absence of the argument address, a sentinel address in the fixture, stack frames and raw fixture content. Compare the complete file bytes before and after. Assert `<file>.lock` is absent and demonstrate immediate successful reacquisition/release through the existing lock API.
3. Run the second approved invocation under the same assertions, using a fresh isolated fixture. Pending the blocking answer, do not claim that another supported command exists or replace it with `failed list` (which operates on the delivery ledger).
4. Exercise the public `runSubscribers` result as well as the subprocess so the intended code-2 result cannot be accidentally supplied by a different entry-point error. If the classifier handles distinct corruption codes, include deterministic fixtures for those claimed cases. Preserve unexpected-error behavior rather than treating every thrown error as a store failure.
5. Each new regression must fail on the actual recorded base for the stated corrupt-store error/exit-1 behavior. Run each regression three times in isolation on base, with fresh fixtures; record commands, test names, observed exit/error and failing assertions. Apply only the new test file to a disposable base checkout in the later implementation environment. Missing imports, dependencies, invalid test setup and coverage-only failures do not establish the regression. Then record the same tests passing on the fix. Isolated tests may need the runner's supported coverage switch to avoid unrelated whole-project coverage failures; preserve committed configuration and run normal full checks afterward.

### Compatibility controls and documentation

6. Specify and run each planned baseline control on base and branch, with recorded passing output: normal normalized deletion/exit 0; absent-store `deleted 0`/exit 0 with no store created; invalid address, wrong arity and unsupported command/exit 1; live-lock refusal/exit 2 with the original owner's lock intact; unsupported schema `user_version=2`/exit 2. For invalid-input controls also point at a corrupt file to protect validation precedence. Measure schema-version behavior through the CLI, not only a store unit test. Do not describe any control as passing on base until actually executed there.
7. Preserve format 1 and the current service startup path by leaving the store and startup implementation protected; run the relevant existing store/startup suites and require `bun run check` in notify to pass with normal lint, typecheck, coverage and hooks. Report tool/runtime versions and actual limitations. No weakening shared configuration or bypassing hooks.
8. Review the semantic README and operator-documentation diff: both describe the new corrupt-store code 2 and agree on the filename diagnostic, privacy and preserved data/lock behavior. Do not document a new command, an automatic repair, or a service-startup change. The plan, task `Files:` and this review must name both documents.
9. New test files contain no explanatory comments except at most the permitted single line naming the class and expected outcome. Prefer no new comments. The PR body lists every comment actually added, or explicitly says none; preserve unrelated existing comments.

### Test CPU

10. Measure the unchanged base suite and the final branch suite using identical pinned dependencies, Bun version, coverage settings and a CPU measurement that includes child processes. Remove the copied regression file from the disposable base after red/control evidence, so baseline CPU measures the original suite. Perform five alternating pairs: base, branch, base, branch, continuing until five values per side. Record user and system CPU (and their sum) for all runs, side medians and the delta; distinguish this from wall time or runtime service performance. No Docker bench. These measurements and full-suite execution are later build requirements, not claims from this review.

### Scope: committed history, index and working tree

11. Every task acceptance must carry the same scope procedure against its recorded pre-edit implementation base; enumerate its exact expected changed paths and protected files. After the last implementation commit require all of:

    - `git diff --name-only "$BASE" HEAD` equals the exact allowed changed-file list, with neither extra nor missing files.
    - `git diff --exit-code "$BASE" HEAD -- <protected files>` exits 0; expand the protected paths explicitly in the plan/task, including the modules and configuration identified above.
    - `git diff --name-only --cached` is empty.
    - `git diff --name-only` is empty.
    - `git status --porcelain` is empty, including untracked files.
    - `git diff --check "$BASE" HEAD` passes.

    Keep evidence/fixture repositories outside the implementation checkout and do not add ignore rules to conceal work. Do not replace the committed comparisons with `git diff "$BASE"` or a BASE-to-worktree protected-path check: those can miss staged or committed protected changes after worktree restoration.

12. Prove that the combined checker detects each state in a disposable fixture repository. A clean fixture with exactly the allowed file changes committed must pass. Independently reset to that allowed commit, then require failure for: a protected worktree-only edit; a staged protected edit; a committed protected edit with a clean status; and an untracked file. Also stage a protected edit and restore only its worktree to BASE, and separately commit a protected edit and restore only its worktree to BASE. In both restored-worktree cases demonstrate that BASE-to-worktree comparison can be empty while the required checker rejects the index/history and inverse worktree change. Record checker exit status for the passing control and every failing scenario. Never perform deliberate forbidden edits in the real implementation checkout.

## Validation performed in this state

Source/instruction inspection and live issue/comment reads only. No notify files were edited; no target tests, scope fixtures or CPU measurements were run, and no such passes are claimed. The initially absent `.factory/work/833` directory is created by writing this artifact; later states must retain it. No labels or provider comments were changed.
