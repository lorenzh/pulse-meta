# Review the spec

Read `{{variables.work_directory}}/{{issue.id}}/plan.md` and
`{{variables.work_directory}}/{{issue.id}}/targets.json` as an independent reviewer.
Do not edit the spec or implement it.
Check them against the issue and the issue comments.
{{#if workspace.contextDirectory}}
Check them against the repositories cloned at
`{{project.root}}/{{workspace.contextDirectory}}/<target>` too. File search skips the clones, so list
or read them directly.
{{/if}}

Check the scope, required behavior, risks, and acceptance evidence. Check that every section is
headed `## Repository: <target>` and names the files, behavior, checks, and completion evidence of
that repository. Check that `targets.json` is a JSON array that lists exactly the repository
sections, in their order, as `{"name","dependsOn"}` objects. Check that every `dependsOn` entry
names an earlier entry and is needed: flag every dependency on a repository whose release the
dependent one does not need, because it serializes work that could run in parallel.

Check that the spec has a `## Performance impact` section. It must name the budget metrics the
change can move with direction and rough size and a way to measure them, or say "none expected"
with a one-line reason that fits the change. Flag a missing section, a bare "none expected", and
an impact that contradicts the described behavior (for example a new background loop or a larger
image without any metric named). If the section is missing or implausible, transition to `plan`
with a concise defect report.

If either file is missing, transition to `plan` with a concise message.
If the spec needs changes, transition to `plan` with a concise defect report.
If a material decision needs a person, request a hold with status `needs-input`.

Return `complete` when the spec is coherent and testable. A person then reviews and merges the
spec pull request. That merge approves the spec, and `factory fan-out` opens one issue per entry
of `targets.json`.
