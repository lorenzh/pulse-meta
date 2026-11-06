# Issue review #509: Small review leftovers (P3), round 8

## Verdict

Ready for `plan`; no question requires a `needs-input` hold. Review date: 2026-11-06 UTC.
The two supplied issue comments are requirements too: repair API domain-bound tests
(review of pulse-api#76, #597), and correct the probe header-env skip message
(review of pulse-probe#50, #599). Neither comment contradicts the original scope.

This review changes only this artifact. Implementation and documentation changes belong
to the following states and target builds. No product tests or runtime reproductions
were run in this state; current behavior below comes from source inspection and is
distinguished from the issue's supplied reproduction results.

## Inspected baseline

Read meta `AGENTS.md`, `README.md`, the approval list, the audit prompt, the referenced
reports and spec #481, plus API, probe and status `AGENTS.md` and the target files below.
Read-only clones were inspected directly, not edited.

| Repository | Captured commit |
| --- | --- |
| meta | `7a4b23fdee91b548009df6051f0714ac3cc226c7` |
| api | `3b29fa0ce29890248ade4294a55812cc77ed951c` |
| probe | `9490141ef9e92044808c70bb8200db3d497d1060` |
| status | `8b6d4315fcb989a7a8d74c063ab08d97c18a7d2d` |
| notify | `c79f0b7cb5e25ada96e6314220e69cf4f5279b32` |
| config | `bc870498cc8e2539a132ce2aac35a09db1deabd8` |
| contract | `ebf6bbc895e54303a71852eb7fc10e4fb7c28aa3` |

Contract main was read for context, not selected as a new dependency pin. API currently
pins contract `c4a2eb5214d48d40d0c1afbae5e3e49463185e15`; probe pins
`7ce23aaf3fa3e038f65ecfed755188b83bde143f`. Tests must exercise the dependencies each
service actually installs.

## Findings and open points for the spec

### 1. Audit paths changed, and some referenced content was superseded

Commit `678821b` moved reports to stable paths. The current files are
`audits/security/notify.{md,json}`, `audits/security/api.{md,json}`, and
`audits/architecture/system.{md,json}`. The dated paths in the issue no longer exist.
The audit prompt explicitly says each stable path holds the current report and git
history keeps older reports.

- Notify's report still covers 2026-10-31. `notify.md:73` still says the token stays in
  `.git/config`. Correct that sentence while retaining SEC-10's id, P3 grade, finding
  and evidence about missing `persist-credentials: false` and the then-unapproved pin.
  These are historical observations on its recorded commits, not claims about today's
  notify workflow or approval list. `notify.json` has no matching credential-storage
  `impact` text; keep the pair consistent without inventing evidence or findings.
- API's report now covers 2026-11-05 (#758). The old credential claim and JSON `impact`
  have already disappeared with replacement of that report. The original mistake was
  verified with `git show 7c5d38a:audits/security/2026-10-31-api.md` and the matching
  JSON: finding `security-api-2026-10-31-2`. Treat direct correction of that superseded
  text as no longer applicable to tracked files; record this disposition in the plan.
  Do not recreate the dated report, rewrite git history, or replace the newer audit
  with the old one. The audit-prompt safeguard remains required.
- Architecture's current report already states at `system.md:302` that #509's status
  import-rule item is resolved. Its current statement agrees with the inspected code.

Earlier path probes failed because the dated reports and `.factory/work/509` were
absent. Reads were repeated against the stable paths and available git history; this
artifact creates the missing work directory. A lookup of the audit's abbreviated API
source commit `11f5555` was unavailable in meta; reading the report at meta commit
`7c5d38a` recovered the relevant historical text instead.

### 2. Checkout storage correction and policy scope

Verified the exact referenced checkout pin, not a moving tag:
[git-auth-helper.ts at 3d3c42e5aac5ba805825da76410c181273ba90b1](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/src/git-auth-helper.ts#L299).
`configureToken` writes the credential into a separate configuration file;
`getCredentialsConfigPath` places it in `RUNNER_TEMP`; local git configuration includes
that path. Distinguish the raw `.git/config` file from the effective included Git
configuration. Moving storage does not remove the persisted-credential concern.

Add the requested short instruction to `.factory/prompts/audit.md`: describe this
storage for the referenced pin, and check pinned action source before describing
credentials. Preserve its outcome contracts and disclosure requirements. Avoid making
this an unconditional claim about every checkout version, including meta's older pin.

The approval ambiguity is already resolved by the two separate checkout rows in
`docs/approved-packages.md` and the #556 spec:

- Meta workflows: `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` (v5.1.0).
- Target repositories: `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1).
- Both require `persist-credentials: false`. Config's `actions-policy.json` contains
  the target pin. Inspected API, notify and config workflows use it and disable
  persistence.

Assume this accepted separation remains the decision. Do not downgrade service
workflows to meta's pin or reopen #556's policy work. The plan can mark the scope item
already satisfied with these references; no new approval or config target is needed.

### 3. Manual-incident DELETE means the legacy route

API `src/server.ts:517-520` calls `store.remove` without reading a DELETE body in
`applyManualWrite`. This serves `DELETE /manual-incidents/:id`, authenticated through
`requireAdmin` before `writeManual`. The separate private route
`DELETE /admin/manual-incidents/:id` already consumes ignored bodies with a size cap
in `src/manual-incident-routes.ts` (`skipBody`).

The new API audit independently records the same remaining legacy bug under
`security-api-2026-11-05-1`, including the supplied 2 MB/204/GET-404 result. Checklist
item 3 already mentions this case as a failing check. Add the regression to the API
tests, and update/annotate that checklist with actual post-fix evidence when available;
keep the JSON checklist and finding consistent. Do not silently recast historical
evidence as a newly successful test on the audit's old commit. A dated follow-up can
retain the finding and identify the fixed commit and new result.

Required interpretation: a DELETE body is ignored, not parsed as JSON. After existing
authentication and routing checks, enforce the shared 16 KiB limit on bytes actually
read before any delete, deletion audit entry or successful-write log. Use the existing
bounded body reader/error mapping; a Content-Length-only guard is insufficient.
Exactly 16,384 bytes is allowed; 16,385 or more yields 413. Empty and other under-limit
ignored bodies preserve successful DELETE behavior. Keep existing auth, disabled
feature, missing-id and privacy behavior; this is not a redesign of manual routes or
a fix for the newer audit's separate private-GET body-limit note.

### 4. Domain warnDays tests must isolate the bound

API `src/config.bounds.test.ts:44` uses `intervalMs: 1000` for its domain fixture and
only checks an error containing `checks[0]`. The admin test moved to
`src/config-admin.test.ts:896-917`; its domain fixture at line 903 still uses 60000
and only asserts 422. API `parseProbed` delegates domain validation to the contract,
including its one-hour minimum interval. Both invalid intervals can mask removal of
the upper warnDays bound.

Use otherwise-valid domain fixtures with `intervalMs: 3600000`. Assert the domain
`warnDays` failure specifically, and prove the same fixture accepts 3650 (and the
documented lower boundary 0) so another invalid field cannot satisfy the negative
case. Cover configuration parsing and the existing POST/PUT admin paths. Keep valid
If-Match revisions and existing-id setup correct in positive write cases, and prove
rejected writes leave configuration/revision unchanged. TLS behavior stays covered.

Mutation evidence should remove only the domain warnDays upper-bound check in the
validator actually loaded by the API in a disposable copy, leaving interval and TLS
validation intact. Both corrected suites must detect that mutation. Do not change
contract production behavior or add a contract target just to obtain that evidence.

### 5. Preserve probe token protection; amend spec #481

Probe `src/token.ts` rejects non-printable-ASCII tokens from both sources after trim.
`src/token.test.ts:157-194` already covers accented/non-ASCII/control characters for
both sources and accepts printable ASCII with an interior space. The source comment
explains the header-error secret disclosure this prevents. Keep the protection.

Meta `.factory/work/481/plan.md` still says env-token parsing is unchanged, says any
otherwise single-line UTF-8 file content is accepted, and promises unchanged rollout
for existing env tokens. Record the explicitly requested changed decision there,
either by consistently amending affected requirements or a clearly dated override
that names the superseded clauses. Preserve trim, source exclusivity, single-line
file rules, startup-only reading and secret-free errors. Both trimmed sources must
be nonempty printable ASCII U+0020..U+007E; UTF-8 is the file decoding, not permission
to accept non-ASCII token characters. The env error is
`PULSE_PROBE_TOKEN must hold printable ASCII`; file errors name its setting/path,
never token content. Invalid startup exits 2 before outbound requests.

This is a decision-history correction in meta, not authorization to remove the guard
or add new restrictions such as a minimum length or forbidding interior spaces.
No probe runtime change or kit work is necessary for this item.

### 6. Probe header-env documentation comment

Probe `docs/configuration.md:100` still promises `... env NAME must start with
PULSE_HEADER_`. Current `src/client.http-options.test.ts:147-172` explicitly says the
contract rejects such names before any env lookup. `src/client.ts:264` logs invalid
checks through the validation-error path. Replace the stale example with the current
contract form, including the complete pattern, for the issue's `doc` fixture:

`skipping invalid check doc: checks[0].headers.X-Key.env: must match ^PULSE_HEADER_[A-Za-z0-9_]{1,115}$`

Distinguish invalid names from a valid prefixed name whose env value is missing or
invalid: those still have their separately documented skip reasons. Preserve the
existing dedupe and no-secret rules. This is documentation work in probe, not a
contract or runtime logging change. Verify the example through the installed
contract/client path rather than inventing a new message to match the docs.

## Scope and assumptions

- Remaining implementation targets: API (DELETE guard and meaningful bounds tests)
  and probe (configuration documentation). Meta changes cover the notify correction,
  audit prompt, #481 decision record and API audit follow-up.
- Status's rule/import decision and checkout policy scope are already satisfied.
  No status, notify, config, kit or contract implementation task is needed on this
  baseline. Record satisfied items in the plan rather than adding empty target tasks.
- The existing decisions and functionality from #481, #556, #597 and #599 are inputs
  to this feature, not work to redo. Recheck target main when planning; if a remaining
  fix has landed, retain its acceptance evidence and avoid duplicating it.
- No new dependency, public route, wire shape, setting or action pin is required.
  API is security-impacting because it changes enforcement before an authenticated
  destructive operation. Use throwaway local fixtures for verification.
- Meta owns all work/spec/audit files. If an audit follow-up needs a merged API SHA,
  sequence that follow-up after the API result; do not fabricate a commit or test
  outcome while writing the spec. API and probe product work otherwise has no
  dependency on each other.

## Derived acceptance check

The feature is done when the remaining corrections and regression checks below pass,
and the plan records evidence for already-resolved/superseded items above:

1. Notify SEC-10 accurately locates persisted credentials in the runner-temp file
   referenced by `.git/config`, retaining the historical finding. For the historical
   checkout probe, the result is `tokenInGitConfig=false; tokenInRunnerTemp=true`;
   inspect raw files without printing the token. Do not rerun today's already-hardened
   workflow and claim it reproduces the old persistence setting. No current API audit
   text/JSON claims that token bytes live in `.git/config`. Audit prompt contains the
   pinned-source check and credential-storage guidance; checkout policy retains its
   explicit meta/target split. JSON remains parseable and agrees with report changes.
2. A real local API server with a valid admin token and an existing public manual
   incident returns 413 to legacy DELETE bodies of 16,385 bytes and 2 MB; subsequent
   GET returns 200 with unchanged incident data and no deletion audit entry. A streamed
   over-limit body without Content-Length also yields 413 before mutation. Fresh
   fixtures with empty and exactly 16,384-byte ignored bodies still return 204 and
   then GET 404. Missing/invalid credentials and insufficient scope retain 401/403
   before body enforcement; the private DELETE's existing 413 behavior remains.
3. Corrected API tests use valid one-hour domain intervals; 0/3650 pass, 3651 fails
   for warnDays specifically in parsing and POST/PUT. Rejected writes leave state
   unchanged. Removing only the effective domain upper-bound check makes both suites
   fail, and restoring it makes them pass. Existing TLS cases continue to pass.
4. Spec #481 explicitly adopts the current printable-ASCII protection for both
   sources and supersedes the earlier parsing/UTF-8 acceptance promise. Existing
   probe token tests remain green, including rejection of `0123456789abcdefé`
   without echoing it and acceptance of trimmed printable ASCII.
5. Probe configuration docs show the exact invalid-name example above. A client
   check with id `doc`, index 0 and header `X-Key` referencing an unprefixed env name
   emits that message, skips the check and never reads that variable. Valid prefixed
   env handling and its documented missing-value messages still work.
6. API checklist item 3 and matching JSON retain the original observation and add
   accurately attributed follow-up evidence once tested. Changed targets pass their
   required `bun run check`; API also gets the required local `bun start` smoke check
   for the changed endpoint, with commands/results reported. Documentation-only
   changes need focused content/link checks, not unrelated new test suites.
