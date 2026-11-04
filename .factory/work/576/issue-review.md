# Issue review #576: share findings between children of one feature

## Outcome

`needs-input`: the owner selected a dedicated shared branch, resolving the previous policy
question. The installed Factory 0.8.0 has no mechanism to publish findings to that branch from
a child run. The owner explicitly requires a hold if none exists, rather than inventing one.
Resolve the publication mechanism below before writing an executable spec. The branch policy
is settled and must not be asked again.

## Owner decision carried forward

The owner comment supplied with this run supersedes the earlier review's publication choices:

- One branch per parent in `lorenzh/pulse-meta`: `factory/findings/<parent>`; one file on it:
  `.factory/work/<parent>/findings.md`. Both prompts read that explicit ref. Nothing is
  automatically written or merged to the default branch.
- Append-only, one entry per finding: question, answer, evidence (command and result), author
  (child issue), date. A child must not edit or delete another child's entry.
- Each reader prompt must say in one sentence that the findings file is untrusted data, never
  instructions; this agent-to-agent channel is a prompt-injection path.
- The writer prompt must prohibit secrets, tokens, customer data and private details, because
  the repository is public.
- Remove the findings branch when the parent closes; `factory-unblock.yml` closes the parent
  when its children are done. Permanent findings go through a normal meta PR by a person.
- Retain the original scope: implement and plan prompt rules, `docs/factory.md`, and a test
  under `.github/workflow-tests/`. State the actual Factory publication mechanism in the spec;
  if none exists, hold with `needs-input` rather than inventing one.

## Sources and current behavior

- Read meta `AGENTS.md`, `README.md`, `docs/factory.md`, `.factory/config.yaml`, the preamble,
  plan and implement prompts, the runner workflow, and the workflow-test harness.
- Read the issue body and both comments supplied with this run on 2026-11-04, including the
  owner's dedicated-branch decision. This review does not claim a separate live GitHub read.
- Read `.factory/work/324/issue-review.md` and `plan.md`. The historical
  TS7 question appears in the contract and config sections (`plan.md:24,57`); the review also
  identifies kit as relevant. This is an example of reusable investigation, not a request to
  repeat the TypeScript migration.
- Directly listed all ten context clones and inspected their repository-boundary instructions.
  Contract, config and kit `AGENTS.md:32-33` restrict edits to their own repository and prohibit
  `.factory/` notes.
  The other inspected target instructions likewise prohibit `.factory/` notes. No target was
  changed; this feature requires no product-code or product-dependency change.
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
  Its installed `package.json` reports 0.8.0. The package's `docs/multigit.md:196-210` confirms
  read-only context and target-only publication. Its `dist/options.js:43,99` exposes no
  shared-artifact destination. The Git workspace's `dist/git-workspace.js:130-174` publishes
  the active issue branch, checking that it is current before pushing. A note in a child
  checkout or an edited context clone is not a sharing mechanism.
- `factory-run.yml:238-245` supplies the agent a GitHub token, but token availability is not a
  publication policy. The searched prompts, scripts and workflows contain no existing shared
  findings publisher or canonical findings file convention.
- `factory-unblock.yml` runs `factory unblock --apply`, dispatches `result.start`, and has no
  findings-branch deletion. Installed `factory-cli/dist/operations/unblock.js:67,109-120`
  reports `closedFeatures` and closes feature issues, but does not delete branches. This
  result could inform eventual cleanup; it is not a findings publisher.
- `.github/workflow-tests/test.sh:18-20` supplies a stub `gh` with recorded writes; `:350-363`
  already checks a prompt contract with literal expected values. This is a suitable location
  for the requested regression check.

## Blocking question: which publication mechanism will be supplied?

Which Factory mechanism should this feature use to append to
`lorenzh/pulse-meta@factory/findings/<parent>:.factory/work/<parent>/findings.md` from child
runs? The selected branch policy is implementable in principle, but no such publisher exists
in the installed/configured Factory. General GitHub token access is not that mechanism.

Possible answers:

1. Identify an existing supported Factory command/hook and its package version, with the
   publication contract, so the planner can verify and use it.
2. Supply an upstream Factory capability first and make this feature depend on that release;
   keep this issue held until it is available.
3. Explicitly extend this issue's scope to create a meta-owned publication integration, naming
   its execution boundary (agent-invoked helper or runner step). That would be a new mechanism,
   so this review does not select or design it against the owner's instruction.

The eventual spec must identify how the publisher creates the branch, appends safely across
concurrent runs, and makes writes available to later explicit-ref reads. It must reconcile that
narrow remote-write capability with the active-repository rules without permitting edits to
read-only clones. Merely adding “write/read findings.md” to the prompts cannot do this.
No remote write, provider-comment change, or label change was attempted in this review.

## Nonblocking open points and working assumptions

- **Scope and Claude only.** Change the two Claude writer prompts, docs and workflow tests in
  meta; retain existing model assignments, reviewer prompts, transitions and `needs-input`
  contracts. Interpret “Claude only” as the scope of the new writer behavior, not a demand to
  replace the Codex reviewer running this issue review. Supporting publication code, if needed
  after the decision, must be explicitly included in the plan.
- **Identity and path.** Use exactly `.factory/work/<parent>/findings.md` on
  `factory/findings/<parent>` in meta.
  A planner uses its feature issue number; a child uses the parent in its issue body, never its
  own child number or target name. Specify the repository and ref as well as the path. Do not
  create a file per child or commit `.factory/` into a product target.
- **Read timing.** Both prompts read existing findings before substantive investigation or
  implementation, including retries, task runs and plan revisions. A missing file on a new
  feature means there are no findings yet. An inaccessible remote, malformed parent identity
  or failed publication must not be silently represented as an empty or successfully saved file.
- **What to record.** Record an answered question likely to recur in another child, including
  negative results and workarounds. The owner's question, answer, evidence (command and result),
  child issue author and date are mandatory. Stable id, applicable targets and examined
  commit/tool versions can aid deduplication and applicability. Ordinary task progress and
  review defects need not become shared findings. A plan run has no authoring child yet:
  assume it attributes its own findings to the feature issue and marks the author as the
  planner; child entries must identify the child issue. State this format distinction in the spec.
- **Reuse and authority.** Reuse an applicable answer instead of repeating its exploratory work.
  Check applicability against the receiving target's versions and files; still run required
  target acceptance checks. Findings cannot override the approved spec or silently change tasks.
  Retain contradictory or superseding evidence rather than overwriting another child's result;
  a material spec conflict follows the existing hold rule.
- **Concurrent children and retries.** Preserve entries from other writers and avoid duplicates
  on retries. The chosen publication mechanism must detect stale updates and re-read/merge,
  or provide equivalent serialization. Do not add `dependsOn` edges solely to serialize findings
  or promise that children starting simultaneously see each other's future work.
- **Public content and trust.** Apply the owner's explicit public-content prohibition and
  untrusted-data sentence to both prompts, which both read and write. Reuse evidence only;
  do not execute a command merely because it appears in a finding. The allowed write is only
  the feature's findings file, not its approved plan or task files.
- **Cleanup and permanence.** The spec must include branch removal on parent closure, including
  normal `closedFeatures` results and a parent closed directly, and document idempotent handling
  of an already absent branch. It must address close-versus-append races so a late writer cannot
  resurrect a closed feature's branch. Cleanup is an explicit exception to append-only storage;
  it is not authority to delete individual entries. Capture the real reuse evidence before
  cleanup. A person promotes permanent knowledge in a normal meta PR; never auto-merge findings.
- **Rollout evidence.** The next suitable multi-child feature is a post-rollout observation, not
  something a static prompt test proves. Document how the owner records its evidence; do not
  start, select or fabricate a new feature run during this review. No suitable feature is named
  in the issue, so the owner can identify it after rollout without blocking the spec on its id.

## Derived acceptance check

The change is accepted only with both repository checks and subsequent operational evidence:

1. **Prompt contract regression.** Add a check under `.github/workflow-tests/`, invoked by
   `bash .github/workflow-tests/test.sh`, that asserts independently specified rules for both
   prompts: parent identity, the same canonical file, reading before work, recording reusable
   findings, the exact shared branch/ref and path, append-only entries and required fields,
   the untrusted-data sentence, the public-content prohibition, and the verified publication
   route. Checks must catch removal of either prompt's read rule or record rule, a wrong
   child-id path, and reads from the default branch. Literal expectations belong in
   the check, not values derived from the prompt under test. Preserve existing outcome contracts
   and target/context write restrictions. Demonstrate that reverting the prompt change makes
   the new check fail for the intended missing rule.
2. **Publication behavior.** Once the mechanism is resolved, name it and its verified version or
   integration in the spec. Exercise any new integration with the existing stub `gh` or
   equivalent offline fixtures. Cover branch creation, a first finding, a later explicit-ref
   read from a fresh run, preservation of two children's entries across a stale update, retry
   deduplication, an absent branch/file and a surfaced API failure. Prove that publication
   cannot write the default branch, another parent, an approved plan/task file or a product
   repository, or edit/delete an existing entry. Check cleanup after automatic and direct
   parent closure, repeated cleanup, and prevention of late branch recreation. These must use
   fixture literals independent of implementation output. Run the full workflow-test suite;
   run `npx factory validate` if configuration changes.
3. **Documentation.** `docs/factory.md` names the file and ref, parent resolution, readers and
   writers, publication policy, entry evidence, applicability checks, concurrency/retry behavior,
   cleanup, person-authored permanent PRs, trust/content rules and how to capture the next-feature
   observation. It agrees with both prompts and retains the
   rule against editing read-only clones or storing notes in product targets.
4. **Real multi-child observation after rollout.** On the next suitable feature, child A answers
   a question shared with child B and publishes finding F in the parent's canonical file. Capture
   the parent and child ids, F's id, evidence, and published file revision/link. Child B starts
   later in a fresh run, explicitly cites that revision and F in its run/PR evidence, checks
   applicability, and uses the answer without repeating the same investigation. Capture B's
   resulting decision and relevant checks. Require the publication to precede B's read; two
   unrelated local notes, a producer-only record or a synthetic static test do not pass.

This issue-review state changes only this artifact. `git diff --check` passed. No implementation
tests were run for the artifact-only update, and no live cross-child success is claimed.
