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

Check the four required sections, and transition to `plan` with a defect report when one is
missing, empty, or contradicts the described behavior:

- `## Security impact`: the first line is exactly `Security impact: yes` or `Security impact: no`
  with a reason. Flag `no` for a change that touches admin routes or authentication, parsers or
  validators at a trust boundary, the probe HTTP client, headers or redirects, file writes, error or
  log texts with external data, dependencies, Dockerfiles, or CI.
- `## Rollout order`: for a change across repositories, the order and the older consumers (probes
  and services on old pins) at each step. Flag an order in which an old consumer breaks.
- `## Counterexamples`: at least one per hard rule. Flag a statistic without an exact definition
  and any average of percentiles.
- `## Contract fields`: each new name with the search that shows no collision. Repeat the search
  for at least one name yourself.

Check that every repository section starts with a `Files:` list and that the files exist in the
clone or are marked as new. Check the spec against itself: flag two statements that cannot both
hold (for example "never runs inside a request" and "runs on the first read").

If either file is missing, transition to `plan` with a concise message.
If the spec needs changes, transition to `plan` with a concise defect report.
If a material decision needs a person, request a hold with status `needs-input`.

Return `complete` when the spec is coherent and testable. A person then reviews and merges the
spec pull request. That merge approves the spec, and `factory fan-out` opens one issue per entry
of `targets.json`.
