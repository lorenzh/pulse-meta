# Review the spec

Read `{{variables.work_directory}}/{{issue.id}}/plan.md`,
`{{variables.work_directory}}/{{issue.id}}/targets.json`, and the task files
`{{variables.work_directory}}/{{issue.id}}/tasks/<target>.json` as an independent reviewer.
Do not edit the spec, the task files, or implement them.
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
clone or are marked as new. Check that the line after it is `Behavior change: yes` or
`Behavior change: no` with a reason, and flag `no` for a section that asks for new or changed
behavior. Check every tool fact that a section relies on (a tool or runtime version, which
linter, formatter, or type checker runs, the Biome include or ignore scope, a test runner flag, a
CI step): it cites file and line in the target's `package.json`, `biome.json`, `bunfig.toml`, or CI
workflow, and in config at the ref that the target pins when the target file `extends` or `uses`
config. An unverified tool assumption is a defect. Repeat the check for at least one cited tool
fact yourself. Check that every acceptance check names a literal expected value or an independent
source for it. Flag an acceptance check that derives its expected value from the file it checks
(read from, or regenerated from, the file or code under test in the same run): it can never fail.
Check the spec against itself: flag two statements that cannot both
hold (for example "never runs inside a request" and "runs on the first read").

## Task files

Run the mechanical check. It needs one task file per entry of `targets.json`, 1 to 8 tasks `T1` to
`Tn` with the last one `final`, the keys of each task, and every path of a section's `Files:` list
in a task:

```sh
node scripts/factory-tasks.mjs --check {{variables.work_directory}}/{{issue.id}}
```

Then check the cut of each file against its section and the code of its repository:

- A split sits at a real seam. Flag a task that could merge with its neighbor (one file, or under
  about 200 changed lines together), and stages of one algorithm cut into separate tasks.
- Tests are in the task of the code they test, and each task can leave lint, typecheck, and tests
  green on its own. A task comes after the tasks it needs.
- Every behavior and acceptance check of the section maps to a task (`spec`).
- A `step` task's acceptance runs locally; the compose end-to-end test, the security checklist, and
  the pull request evidence are in the `final` task.
- Every `expected` value is a literal or an independent source, as for the acceptance checks.
- `behaviorChange` agrees with the section's `Behavior change:` line.

## Outcome

If the spec needs changes, or `plan.md` or `targets.json` is missing, transition to `plan` with a
concise defect report. A changed spec gets new task files after it.
If only the task files need changes (the check fails, a file is missing, or the cut is wrong),
transition to `breakdown` with a concise defect report.
If a material decision needs a person, request a hold with status `needs-input`.

Return `complete` when the spec is coherent and testable. A person then reviews and merges the
spec pull request. That merge approves the spec and its task files, and `factory fan-out` opens one
issue per entry of `targets.json`.
