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

Write these sections before the repository sections too. Every spec has all four:

- `## Security impact`. Its first line is exactly `Security impact: yes` or `Security impact: no`,
  followed by a one-line reason. Write `yes` when the change touches any of: admin routes or
  authentication; parsers or validators at a trust boundary (contract); the probe HTTP client, its
  headers or redirects; file writes; error or log texts that carry external data; dependencies;
  Dockerfiles; CI. With `yes`, name the checklist items that apply (secrets in errors, logs and
  responses; auth order and status codes; body and size limits; input validation; accessor
  execution; SSRF and redirects; atomic, path-safe writes; dependency pins). A `yes` adds a
  security state with hostile inputs after the review.
- `## Rollout order`. When the change crosses repositories, list the merge and release order and,
  for each step, which older consumers still run (probes and services on old pins of contract,
  kit, or config; status against an older api) and why they keep working. For one repository,
  write "one repository" with the reason.
- `## Counterexamples`. For every hard rule (limits, ordering, status codes, validation,
  statistics), give at least one input or case that the rule must reject or that a wrong
  implementation would get wrong. Define every statistic exactly: window, sample set, percentile
  method, rounding. Never average percentiles; say how they are computed from the samples.
- `## Contract fields`. List every new or renamed field, key, name, or route. For each, show the
  search of the contract and config clones that proves it does not collide with an existing name
  (for example `grep -rn '<name>' .repos/contract/src`).
  If there is none, write "no new names".

Then write one section per repository that must change, headed `## Repository: <target>` with
the target name of that repository, which is also its directory name in the context directory.
Each section starts with a `Files:` list of every file it creates or changes, then names the
behavior, checks, and completion evidence of that repository's task. Leave out every repository that needs no change. Order the sections so that a repository
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
