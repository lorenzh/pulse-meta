# Issue review: #870 — e2e failure-log credential masking

## Outcome

Ready for `plan`; no blocking question. Security impact: yes, in test diagnostics.
Only `deploy` needs implementation, with no target dependency. The reviews cited
in the request establish a masking limitation, not evidence that a service emits
these credentials. Do not change service logging or product behavior here.

The issue comments are the record of earlier decisions. This checkout contained
no `.factory/work/870/` artifacts before this review, so the previous plan and task
could not be inspected. Planning must recreate them from this review and the
comments, including the manager's quoted-JSON-cookie requirement. Historical
claims that a plan passed review do not waive that requirement.

## Inspected baseline and current behavior

- Deploy implementation base inspected: `f7210ec3e9905cf0c3eeaf9d86ad662008578ebf`
  (merge of pulse-deploy#18). Read deploy's `AGENTS.md`, package scripts,
  `e2e/redact.sh`, its test, `compose-e2e.sh`, `console-lib.sh`,
  `console-setup.sh` and its test, the console scenario callers,
  `runtime-settings.sh`, `subscriptions.sh`, `.github/workflows/ci.yml`,
  `README.md`, `dev/README.md` and `docs/cli.md`.
- `redact_needles` currently collects explicit token arguments, the owner file's
  password and TOTP key, and secret-file lines. Cleanup also supplies runtime
  service tokens. It does not collect the five requested categories.
- `redact` currently performs literal substitution only. A missing/unreadable
  needles file produces `[redacted: no needles file]`, but a readable empty or
  incomplete file is trusted. There is no credential-field fallback.
- Shared `req` writes the response body, response headers and current cookie jar
  to files. `csrf`, `form_token_args` and `totp_after` select transient values.
  Requests frequently run in command substitutions, so an in-memory array or
  variable cannot reliably carry credentials back to the run owner.
- Cookie jars are replaced during sign-in and browser changes; headers and bodies
  are overwritten on each request. Recovery codes may appear on a single
  response page. A final scan of the remaining files misses earlier values.
- Probe, incident and runtime children use `console-lib.sh`.
  `runtime-settings.sh` also has its own `form_args` parser. Their captured output
  can reach the terminal before final cleanup: probe failure output is printed
  directly, while incident/runtime scans cover limited credentials. Those raw
  scans must remain effective; masking before a scan would conceal violations.
- The standalone `console-setup.sh` removes its temporary response files at exit.
  The CI `dev` job subsequently prints container logs directly on failure,
  bypassing `redact.sh`. Changing only compose cleanup leaves this path open.
- Console source was inspected read-only at
  `aa5dc1808d55f9e6655f4da78388957b522c189a`: `src/cookies.ts` defines
  `pulse_console_session`, `pulse_console_csrf`, `pulse_console_setup` and their
  `__Host-` variants; `src/recovery-codes.ts` defines ten recovery codes, each
  eight groups of four lowercase hexadecimal characters. These observations
  inform deploy fixtures; no console change is required.
- The proposed names `E2E_NEEDLES`, `needle_add`, `needles_valid`,
  `replay_redacted` and `setup_exit` had no matches in the inspected deploy e2e
  and workflow files or the config/contract clones. A no-match search is expected.

## Decisions carried forward and gaps the spec must settle

### 1. Credential collection and lifetime

Use the previously agreed run-owned registry, exported as `E2E_NEEDLES`, mode
600 in a mode 700 directory. Capture values when observed, before another request
or cleanup can destroy them. Keep every observed value until the last diagnostic
consumer has finished, including replaced cookies, prior CSRF/form tokens, all
generated TOTP codes and every displayed recovery code, not just the code used.

The shared helpers must record jar cookies (including HttpOnly entries),
Set-Cookie values, every CSRF and form-token field in responses and recovery-code
values. Selection helpers also record values they return or set. Cover
`runtime-settings.sh`'s `form_args` and standalone setup credentials. Record
without changing the selected form, curl arguments, HTTP checks, token replay
checks, TOTP timing or successful output. Do not introduce stdout from collectors
that contaminates a command substitution's result.

The spec must distinguish ownership: compose owns its registry for its children;
the CI run owns a registry that survives standalone setup until the failure-log
step; a standalone invocation without a supplied registry owns and removes its
private registry. A child must neither remove its parent's registry nor create a
new file at a missing inherited path. Release registry files, invalid markers and
their owned directory on success and failure, after the last consumer.

### 2. Fallback suppression, including quoted JSON cookie keys

When a value is not available to the registry, suppress the whole
credential-bearing diagnostic line and emit only the agreed safe marker
`[suppressed: credential line]`. This includes once-visible credentials. Retain
literal substitution for collected values in otherwise unlabelled text.

Define the supported field shapes explicitly, with bounded field-name matching:
cookie/Set-Cookie headers, unquoted cookie assignments, quoted JSON cookie keys,
CSRF/form-token fields (including form markup), TOTP/recovery-code fields and
existing setup-code/Authorization credential lines. The manager specifically
requires unregistered cases for `"cookie": "<sentinel>"`,
`"set-cookie": "<sentinel>"` and
`"pulse_console_session": "<sentinel>"` alongside the header cases. Also cover
the actual console cookie names and their `__Host-` forms. The value must be
absent from the registry in fallback tests; registering it would test substitution
instead and miss the reviewed defect. Preserve benign neighboring lines.

Use portable awk expressions; the earlier decision avoids interval expressions
whose support differs between mawk and gawk. Tests should exercise both when
available and record tool availability. Do not claim arbitrary unlabelled unknown
secrets can be identified by field suppression.

### 3. Persistent failure must close every diagnostic path

Retain the revised design from the comments: `needles_valid` accepts an unset or
empty `E2E_NEEDLES` for backwards-compatible non-recording helpers. When set, it
requires no `<registry>.invalid` marker, a regular non-symlink registry that is
readable and writable, and a writable containing directory. Append helpers never
create a registry. On append failure, invalidate persistently by creating the
marker and removing the registry; later processes must refuse it and never
recreate it. Do not trust a readable but incomplete registry.

Recording failure stops the scenario with a credential-free error such as
`FAIL: needle registry: append failed`. A subshell failure can be swallowed by a
caller, so both compose cleanup and standalone `setup_exit` must turn incoming
success into failure when the registry is invalid. `redact_needles` must fail on
invalidity, and cleanup, child-output replay and `failure-logs.sh` must then print
only `[redacted: no needles file]` for the diagnostic payload. The CI helper must
return failure for this condition. Do not accidentally hide failures behind the
exit status of a pipeline or a successful marker print.

The comments accept a residual filesystem limit: collection failure cannot be
persisted if neither marking nor removal succeeds and the registry still appears
writable. State this accurately in the spec and README; do not describe the
mechanism as covering that condition.

### 4. Consumers and scope

Route compose failure container logs and failed probe/incident/runtime child
output through the same mechanism. Replay successful child output unchanged;
invalidity still forces a failure and suppresses its payload. Keep raw privacy
scans and their existing results unchanged. A new `e2e/failure-logs.sh` closes
the standalone setup bypass in the CI `dev` job. Limit workflow edits to registry
creation/export, this failure step and final removal; preserve other jobs,
service checkouts, action pins and the existing teardown.

Do not broaden this issue into CLI logging, subscription-mail credential
collection, service logging, image bumps, Compose behavior or deployment changes.
The subscription scenario does not use these console helpers and is not a sixth
requested credential category. Any changed common diagnostic filter still applies
to container logs printed after a subscription failure.

### 5. Documentation consistency

`Files:` must include **README.md and dev/README.md**, with real changes and
matching acceptance. Root README owns the e2e diagnostics description. Dev README
owns running standalone setup and must explain the CI failure-log path and
registry ownership/lifetime. Explain the five categories, suppression markers,
failure handling and limits without publishing credentials or a recipe for
recovering credentials from failure logs.

**This review does not require a change to docs/cli.md.** It documents CLI/operator
behavior, with no e2e diagnostics text. Keep it protected. This resolves the
manager's documentation consistency choice: plan, task, allowed list and review
must all require the same two changed docs.

The expected implementation boundary, inherited from the comments, is these
eleven files; planning must verify the list and match every task's `Files:` and
scope acceptance to it:

- `e2e/redact.sh`
- `e2e/redact.test.sh`
- `e2e/console-lib.sh`
- `e2e/console-setup.sh`
- `e2e/console-setup.test.sh`
- `e2e/compose-e2e.sh`
- `e2e/runtime-settings.sh`
- `e2e/failure-logs.sh` (new)
- `.github/workflows/ci.yml`
- `README.md`
- `dev/README.md`

Keep scenario checks and success output unchanged within these files. Protect
all other tracked files, explicitly including `docs/cli.md`, `AGENTS.md`,
package/lock files, image pins, Compose/config files and CLI code. No dependency
is needed. No target repository is edited during this review.

## Derived acceptance

1. Record the exact deploy implementation base. On an isolated copy of that
   base, run every control the plan calls baseline-passing and record its actual
   result. Run the existing redaction test (five cases) and console setup test
   (seven cases) there before substituting new regression tests. Run baseline
   `bun run check` with the pinned dependencies as well; an unrun control is not
   a passing control. Repeat the relevant controls on the implementation.
2. Extend `bash e2e/redact.test.sh` with distinct sentinels for cookies, CSRF,
   form tokens, current TOTP codes and recovery codes. Exercise real collection
   helpers and cleanup with stub curl/docker/node as appropriate, rather than
   merely writing every sentinel directly into a final needles file. Put
   registered sentinels in unlabelled diagnostic text so field suppression alone
   cannot satisfy collection. Each category must fail on the recorded base for
   an observed leak and pass on the branch. Accumulate failures so all five
   categories are demonstrated, instead of stopping after the first.
3. Add unregistered fallback cases for all specified fields, with header and
   unquoted-cookie forms followed by the three quoted JSON-cookie forms above.
   Each required JSON case must fail on the base because its sentinel remains,
   then pass on the branch with suppression and no sentinel. Check a benign
   neighboring line still prints. Include literal metacharacters and repeated
   values in substitution coverage, multiple tokens/forms, cookie rotation and
   all recovery codes. Preserve all existing redaction cases.
4. Cover registry lifetime through overwritten response files, multiple jars,
   child exit and owner-file deletion. Verify private modes, no credential
   output, no premature registry removal, and final cleanup. A missing registry,
   invalid marker and read-only registry must suppress diagnostics. Explicitly
   distinguish intentional empty/unset configuration from an invalid supplied
   path. Skip a permissions-only case as root with an explicit reason.
5. Include the previously requested readable-registry append-failure regression
   (historical L5): use a file-size-limit fixture so the write fails even as
   root, while the existing file remains readable. Verify collection failure,
   persistent invalidity in a later process, refusal to recreate the registry,
   suppression of an unlabelled unregistered sentinel, failure when cleanup
   receives status zero, and eventual owned-directory removal. Test a marker
   without a missing file (L6), permissions failure (L7), standalone `setup_exit`
   (L8), and CI helper invalidity (W3). Missing-file coverage alone is inadequate.
6. Exercise failed child-output replay and the CI helper with stub container
   logs, including the unregistered JSON cookie fields and invalid-registry
   case. Check the effective CI `dev` wiring, correct Compose file, retained
   registry until diagnostics and removal under `always()`. Validate both
   stdout and stderr. Successful replay must preserve the original output.
7. `bash e2e/console-setup.test.sh` retains all seven scenarios, exact successful
   output and request/token-binding checks; extend it to check registry
   lifecycle and absence of an invalid marker. Do not carry forward the earlier
   redaction total of 33 (32 as root) as a completeness assertion: the manager's
   added JSON cases require updated totals and explicit case coverage.
8. `bun run check` passes in deploy using its pinned tooling. Run required shell,
   helper and workflow validation and the affected job's checks per deploy's
   `AGENTS.md`; document any unavailable environment-dependent check accurately.
   Run new shell syntax/lint checks on the new script too, before it is tracked.
   Verify README and dev README describe the actual implemented behavior, both
   appear in the final diff and allowed list, and `docs/cli.md` has no diff.
9. Every task must include scope acceptance after its last commit, against its
   recorded implementation `BASE`: compare
   `git diff --name-only "$BASE" HEAD` to the exact allowed file list; require
   `git diff --name-only --cached` and `git diff --name-only` each empty and
   `git status --porcelain` empty. Separately run
   `git diff --exit-code "$BASE" HEAD -- <protected files>` using an explicit
   protected list covering the tracked complement of the allowed paths. Check
   required docs and other promised files actually changed. A clean worktree
   alone does not prove scope, and a commit comparison alone misses staged edits.
10. Prove that scope procedure using a disposable fixture repository, including
    clean and allowed-commit passing states and protected changes in the
    worktree, index and committed history. Include both restored-worktree
    attacks: stage a protected change then restore only its worktree from BASE;
    commit a protected change then restore only its worktree from BASE. Both
    must fail. Uncommitted allowed changes must also fail the final cleanliness
    checks. Do not change a target clone to run these fixtures in spec states.
11. Report test CPU delta from interleaved runs in the order base, branch, base,
    branch. Use the same passing baseline control suite, fixtures and pinned
    tooling in both revisions; report user+system CPU for each run, the aggregate
    delta and context about noise. Measure new regression-only cost separately
    so the changed case count is visible. Do not use shared-machine wall time as
    a performance gate. **Do not run the Docker bench** (port collision, #834).
12. All committed fixtures and public artifacts contain only synthetic sentinels,
    with no real credential or credential-extraction recipe. No dependency,
    product scenario assertion, success output or protected file changes.

## Checks performed in this issue review

- On the recorded deploy base: `bash e2e/redact.test.sh` passed all five existing
  cases; `bash e2e/console-setup.test.sh` passed all seven cases.
- A separate sentinel-only probe of the current filter with an empty readable
  needles source confirmed unchanged output for the five requested credential
  categories and quoted JSON `cookie`, `set-cookie` and
  `pulse_console_session` keys. This establishes the fallback gap; it is not a
  substitute for running the future extended regression test on base and branch.
- Bun is 1.4.0 and Node is v24.19.0 here. Deploy dependencies are not installed;
  shellcheck and gawk are unavailable, while mawk is present. No environment
  status tool is exposed. `bun run check`, cross-awk checks, scope fixtures and
  interleaved base/implementation CPU measurements were not run in this review;
  they remain explicit acceptance work, with no claimed pass or measured delta.
- Initial artifact lookup confirmed this issue's directory was absent. A source
  lookup using nonexistent console filename globs was corrected by reading the
  actual `src/cookies.ts` and `src/recovery-codes.ts`. No inspection failure
  remains unresolved. No Docker benchmark or live stack was run.
- Deploy remained clean after the tests. The only intended meta change is this
  review artifact, retained under `.factory/work/870/` for subsequent states.

## Assumptions and remaining planning work

The comments settle the material choices above; no person needs to decide a new
behavior before specification. Planning must turn the collection/fallback field
shapes, CI registry path and lifetime, persistent-invalidation handling and test
matrix into concrete implementation and acceptance commands. Recheck the base
and repository instructions when implementation starts. If the base moves,
rerun controls and the regression-on-base proof; do not reuse previous evidence
as if it came from the new revision.
