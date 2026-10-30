# Plan

Turn the feature request into a cross-repository spec.
{{#if workspace.contextDirectory}}
Read every repository cloned at `{{project.root}}/{{workspace.contextDirectory}}/<target>` before
you make claims about current behavior: each one is a target that a feature can change. File search
skips the clones, so list or read them directly.
{{/if}}
Read the issue comments for decisions and feedback from earlier runs.

Read the open points and the acceptance check of the issue review in
`{{variables.work_directory}}/{{issue.id}}/issue-review.md`.
If that file is missing, request a hold with status `needs-input`.

State the goal, scope, non-goals, required behavior, risks, and acceptance evidence.

Write a section headed `## Performance impact` before the repository sections. It names which
metrics of `bench/budgets.json` in the api repository the change can move (startup CPU, load CPU,
idle or peak RSS, test CPU, build CPU, and the reported ones: wall-clock startup, p95 latency,
requests per second, image size), in which direction and roughly how much, and how the
implementer measures it (for example a local `bun bench/run.ts --a <ref> --b <ref>` A/B). If the
change cannot move any of them, write "none expected" with a one-line reason. If `bench/` does not
exist yet in `main` of the api repository, name the kinds of metric instead of the keys.

Then write one section per repository that must change, headed `## Repository: <target>` with
the target name of that repository, which is also its directory name in the context directory.
Each section names the files, behavior, checks, and completion evidence of that repository's
task. Leave out every repository that needs no change. Order the sections so that a repository
comes after the repositories it needs.

Create the artifact directory if needed. Write the spec to
`{{variables.work_directory}}/{{issue.id}}/plan.md`.

Write the repositories to `{{variables.work_directory}}/{{issue.id}}/targets.json`: a JSON array
with one object per repository section, in section order, such as
`[{"name":"api","dependsOn":[]},{"name":"web","dependsOn":["api"]}]`.
Never list the meta repository itself: it holds the spec, and no child issue is opened for it.
`dependsOn` names only earlier entries, and only a repository whose released change this one
needs to build or pass its checks. Repositories that share an interface that the spec defines
need no dependency: each one implements its side of it. A dependency serializes work that could
otherwise run in parallel.

Write both files in your working directory. Keep them available to later states. Do not ignore
the work directory.

If the feature needs a material decision, request a hold with status `needs-input`.
State the decision in the outcome message.
Transition to `plan-review` when the spec can be executed and checked.
