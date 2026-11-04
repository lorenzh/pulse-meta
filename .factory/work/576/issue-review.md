# Issue review #576: share findings between children of one feature

## Outcome

`needs-input`: the destination path is specified, but the publication route is not. A child
cannot persist a finding in the shared meta repository through its normal Factory publication.
Choose the publication policy below before writing an executable spec. Other open points can
be resolved by the planner using the assumptions in this review.

## Sources and current behavior

- Read meta `AGENTS.md`, `README.md`, `docs/factory.md`, `.factory/config.yaml`, the preamble,
  plan and implement prompts, the runner workflow, and the workflow-test harness.
- Read [issue #576](https://github.com/lorenzh/pulse-meta/issues/576) and all its comments on
  2026-11-04. Its only comment is the current Factory claim; there are no earlier owner decisions.
- Read `.factory/work/324/issue-review.md` and `plan.md` and the original issue. The historical
  TS7 question appears in the contract and config sections (`plan.md:24,57`); the review also
  identifies kit as relevant. This is an example of reusable investigation, not a request to
  repeat the TypeScript migration.
- Directly listed all ten context clones and inspected their repository-boundary instructions.
  Contract `176fb6e`, config `bc87049`, and kit `536133f` instructions were read in detail.
  Their `AGENTS.md:32-33` restrict edits to their own repository and prohibit `.factory/` notes.
  The other inspected target instructions likewise prohibit `.factory/` notes. No target was
  changed; this feature requires no product-code or dependency change.
- `plan.md:11-13,82-95` currently reads the issue review and writes the plan and target list in
  the feature's work directory. It has no shared-findings rule. During initial planning there
  are no child findings yet, so later plan runs must also handle an existing findings file.
- `implement.md:3-11` identifies the parent from `Part of #<feature>` and reads the approved
  spec from the read-only meta clone. Lines 99 and 177-178 prohibit local `.factory/` notes and
  explain that the target does not commit them. The preamble also says to edit only the active
  repository and not the context clones (`preamble.md:5-10`).
- Every build target excludes `/.factory/` in `.factory/config.yaml`; the meta target accepts
  spec, audit, report and merge, rather than build (`:68-78` and the remaining target entries).
  A meta-only feature must not invent a product target or a meta child to carry the change.
- Checked the installed workspace implementation read-only:
  `../node_modules/@paragondata/factory-workspace-multigit/dist/multigit-workspace.js:155-164`
  refreshes context clones from remote HEAD, and `:260-266` publishes only the active target.
  A note in a child checkout or an edited context clone is not a sharing mechanism.
- `factory-run.yml:238-245` supplies the agent a GitHub token, but token availability is not a
  publication policy. The searched prompts, scripts and workflows contain no existing shared
  findings publisher or canonical findings file convention.
- `.github/workflow-tests/test.sh:18-20` supplies a stub `gh` with recorded writes; `:350-363`
  already checks a prompt contract with literal expected values. This is a suitable location
  for the requested regression check.

## Blocking decision: where and how a child publishes

How should a child publish the single shared file under `.factory/work/<parent>/` in
`lorenzh/pulse-meta` so another child can read it in a later run?

Possible answers:

1. **Automatic updates on meta's default branch.** Allow narrowly scoped GitHub file updates
   for the findings file, without a spec approval or merge for every finding. The spec must
   define the exception to the active-repository rule, conflict handling and allowed path.
2. **Automatic updates on a dedicated shared branch.** Keep findings off the default branch;
   require both prompts to read the canonical file at that explicit remote ref. The spec must
   define branch creation, publication and reads rather than relying on the context clone.
3. **Reviewed pull requests.** Publish findings through meta PRs, with a person merging before
   later children can consume them. The spec must say how a later child learns that a finding
   is pending and whether it waits; recording a finding only on an unmerged PR is insufficient.

The planner can choose the filename and entry format, but choosing among these policies changes
automatic writes, review and availability. Merely adding “write/read findings.md” to the two
prompts would contradict their workspace rules and would not satisfy the acceptance criterion.
No remote write, provider-comment change, or label change was attempted in this review.

## Nonblocking open points and working assumptions

- **Scope and Claude only.** Change the two Claude writer prompts, docs and workflow tests in
  meta; retain existing model assignments, reviewer prompts, transitions and `needs-input`
  contracts. Interpret “Claude only” as the scope of the new writer behavior, not a demand to
  replace the Codex reviewer running this issue review. Supporting publication code, if needed
  after the decision, must be explicitly included in the plan.
- **Identity and path.** Use one canonical file such as `.factory/work/<parent>/findings.md`.
  A planner uses its feature issue number; a child uses the parent in its issue body, never its
  own child number or target name. Specify the repository and ref as well as the path. Do not
  create a file per child or commit `.factory/` into a product target.
- **Read timing.** Both prompts read existing findings before substantive investigation or
  implementation, including retries, task runs and plan revisions. A missing file on a new
  feature means there are no findings yet. An inaccessible remote, malformed parent identity
  or failed publication must not be silently represented as an empty or successfully saved file.
- **What to record.** Record an answered question likely to recur in another child, including
  negative results and workarounds. Suggested fields: stable finding id, question, answer,
  applicable targets, authoring child/target, evidence or command result, examined commit/tool
  versions and date. Ordinary task progress and review defects need not become shared findings.
  The planner may seed already-verified findings while specifying the feature.
- **Reuse and authority.** Reuse an applicable answer instead of repeating its exploratory work.
  Check applicability against the receiving target's versions and files; still run required
  target acceptance checks. Findings cannot override the approved spec or silently change tasks.
  Retain contradictory or superseding evidence rather than overwriting another child's result;
  a material spec conflict follows the existing hold rule.
- **Concurrent children and retries.** Preserve entries from other writers and avoid duplicates
  on retries. The chosen publication mechanism must detect stale updates and re-read/merge,
  or provide equivalent serialization. Do not add `dependsOn` edges solely to serialize findings
  or promise that children starting simultaneously see each other's future work.
- **Public content.** Findings are public artifacts: no credentials or private details. The
  allowed write is only the feature's findings file, not its approved plan or task files.
- **Rollout evidence.** The next suitable multi-child feature is a post-rollout observation, not
  something a static prompt test proves. Document how the owner records its evidence; do not
  start, select or fabricate a new feature run during this review. No suitable feature is named
  in the issue, so the owner can identify it after rollout without blocking the spec on its id.

## Derived acceptance check

The change is accepted only with both repository checks and subsequent operational evidence:

1. **Prompt contract regression.** Add a check under `.github/workflow-tests/`, invoked by
   `bash .github/workflow-tests/test.sh`, that asserts independently specified rules for both
   prompts: parent identity, the same canonical file, reading before work, recording reusable
   findings, and the selected publication/read route. Checks must catch removal of either
   prompt's read rule or record rule and a wrong child-id path. Literal expectations belong in
   the check, not values derived from the prompt under test. Preserve existing outcome contracts
   and target/context write restrictions. Demonstrate that reverting the prompt change makes
   the new check fail for the intended missing rule.
2. **Publication behavior.** If publication code is added, exercise it with the existing stub
   `gh` or equivalent offline fixtures. Cover a first finding, a later read from a fresh run,
   preservation of two children's entries across a stale update, retry deduplication, missing
   file, and an API failure that is surfaced. Prove that writes cannot touch a different parent,
   an approved plan/task file, or a product repository. Run the full workflow-test suite; run
   `npx factory validate` if configuration changes.
3. **Documentation.** `docs/factory.md` names the file and ref, parent resolution, readers and
   writers, publication policy, entry evidence, applicability checks, concurrency/retry behavior,
   and how to capture the next-feature observation. It agrees with both prompts and retains the
   rule against editing read-only clones or storing notes in product targets.
4. **Real multi-child observation after rollout.** On the next suitable feature, child A answers
   a question shared with child B and publishes finding F in the parent's canonical file. Capture
   the parent and child ids, F's id, evidence, and published file revision/link. Child B starts
   later in a fresh run, explicitly cites that revision and F in its run/PR evidence, checks
   applicability, and uses the answer without repeating the same investigation. Capture B's
   resulting decision and relevant checks. Require the publication to precede B's read; two
   unrelated local notes, a producer-only record or a synthetic static test do not pass.

This issue-review state changes only this artifact. No implementation test result or live
cross-child success is claimed.
