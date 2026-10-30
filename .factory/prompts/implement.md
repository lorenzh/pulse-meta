# Implement

The issue body starts with `Part of #<feature>`: the feature issue whose approved spec this
repository implements.
{{#if workspace.contextDirectory}}
The issue body names the spec by its path from the root of the meta repository. The meta
repository is cloned read-only at `{{project.root}}/{{workspace.contextDirectory}}/meta`, the only
copy of it you can read. Read the spec there with your file-reading tool:
`{{project.root}}/{{workspace.contextDirectory}}/meta/{{variables.work_directory}}/<feature>/plan.md`.
File search skips the clones, so read the path directly. Implement only its section
`## Repository: {{workspace.target}}`.
{{/if}}
Read the issue comments for decisions and defect reports from earlier runs. When a comment says that
an issue this one waited for is closed, the release that the section needs from that repository
exists: fetch it with the repository's own tools, for example by updating the dependency.

If the spec or the section is missing, if a repository that the section depends on has not
released its change yet, or if the work needs a material decision, request a hold with status
`needs-input`. State what the person must resolve.

Keep changes within the section. Run the checks that prove the changed behavior.
Do not write `.factory/` or any other notes into this repository.
Put the changed files, behavior, check results, and remaining limitations in the outcome message.

Transition to `review` when the change and its checks are complete.
Use `retry` only when useful work remains for another fresh run.

The pull request body carries the acceptance evidence that the spec section asks for (leftover
checklist, mutation output, inventory of removed or changed tests), not only `Closes …`.
