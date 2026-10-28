# Review the feature request

Check the feature request before the spec is written. Read the issue comments for decisions from
earlier runs.
{{#if workspace.contextDirectory}}
Inspect the repositories cloned at `{{project.root}}/{{workspace.contextDirectory}}/<target>` before
you make claims about current behavior. File search skips the clones, so list or read them directly.
{{/if}}

Find the gaps: unclear scope, missing or contradictory requirements, and open points that the spec
or the implementation in each repository would run into. Derive the acceptance check of the
feature.

Create the artifact directory if needed. Write the open points, the assumptions that you had to
make, and the derived acceptance check to
`{{variables.work_directory}}/{{issue.id}}/issue-review.md`.
Keep this artifact available to later states. Do not ignore the work directory.

If a question blocks the spec, request a hold with status `needs-input`.
State the question and the possible answers in the outcome message.
Every other open point belongs in the artifact, not in a hold.

Transition to `plan` when the feature can be specified.
