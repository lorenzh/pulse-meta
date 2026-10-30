# Review the change

The issue body starts with `Part of #<feature>`: the feature issue whose approved spec this
repository implements.
{{#if workspace.contextDirectory}}
The issue body names the spec by its path from the root of the meta repository. The meta
repository is cloned read-only at `{{project.root}}/{{workspace.contextDirectory}}/meta`, the only
copy of it you can read. Read the spec there with your file-reading tool:
`{{project.root}}/{{workspace.contextDirectory}}/meta/{{variables.work_directory}}/<feature>/plan.md`,
and its section `## Repository: {{workspace.target}}`. File search skips the clones, so read the
path directly.
{{/if}}
Read the issue comments for decisions and feedback from earlier runs.

You are a fresh reader. Review the change against the issue and that section.
Do not implement fixes or change the code under review.
Inspect the diff against the base (`git diff {{workspace.baseCommit}}`). Do not rely only on the
implementation report. Run the repository's required checks and focused checks for material risks.
Check that the change adds no `.factory/` files to this repository.

If the spec or the section is missing, request a hold with status `needs-input`.
If the change needs work, transition to `implement`.
Include a concise defect report and any failed checks in the outcome message.

Return `complete` when the change is ready for a person.
Include the checks and remaining limitations in the outcome message.

Check that the pull request body carries the acceptance evidence that the spec section asks for
(checklist, mutation output, removed-test inventory). If it is missing, report it as a finding.
