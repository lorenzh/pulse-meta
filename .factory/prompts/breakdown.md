# Break the spec into tasks

Read the spec `{{variables.work_directory}}/{{issue.id}}/plan.md` and the repository list
`{{variables.work_directory}}/{{issue.id}}/targets.json`. Read the issue comments for decisions and
for defect reports of earlier plan reviews.
{{#if workspace.contextDirectory}}
Read the repository of each section at `{{project.root}}/{{workspace.contextDirectory}}/<target>`
before you cut it: a task is sized against the current code. File search skips the clones, so list
or read them directly.
{{/if}}

Do not change `plan.md` or `targets.json`. When a section is defective (no `Files:` list, no
`Behavior change:` line, or it contradicts the code), write no task file for it and name the defect
in the outcome message; the plan review sends the spec back to `plan`.

## Task files

Write one file per entry of `targets.json`:
`{{variables.work_directory}}/{{issue.id}}/tasks/<target>.json`. Delete a task file whose target is
no longer in `targets.json`. When task files exist from an earlier run, rewrite them for the current
spec. A child issue runs one task per agent run, in order; a fresh reviewer accepts each task before
the next one starts, and the last task goes to the review of the whole change.

```json
{"version": 1, "target": "api", "tasks": [
  {"id": "T1", "kind": "step", "title": "Parse the retry window",
   "files": ["src/config.ts", "src/config.test.ts"], "behaviorChange": true,
   "spec": "## Repository: api, item 1 (retry window)",
   "acceptance": [{"command": "bun test src/config.test.ts", "expected": "exit 0; the test \"rejects a window of 0\" passes"}]},
  {"id": "T2", "kind": "final", "title": "Reload loop, compose end-to-end test and evidence",
   "files": ["src/reload.ts", "src/reload.test.ts"], "behaviorChange": true,
   "spec": "## Repository: api, items 2-3 and the acceptance checks",
   "acceptance": [{"command": "bun run check", "expected": "exit 0"},
                  {"command": "docker compose -f compose.e2e.yml up --exit-code-from e2e", "expected": "exit 0"}]}
]}
```

Every task has exactly these keys. `id` is `T1` to `Tn` in order, with at most 8 tasks. `kind` is
`step`, and `final` for the last task only. `title` says what becomes true. `files` lists the paths
the task creates or changes. `behaviorChange` is `false` only for a pure refactor or a change of
tests or docs alone; when the section says `Behavior change: no`, every task says `false`. `spec`
names the part of the section that the task implements (item, bullet, or check). `acceptance` lists
commands, each with the result that proves the task (`expected`).

## How to cut

- Split only at a real seam. Every task adds a fresh implement run and a task review before any
  work starts. A change in one file or under about 200 changed lines is one task. Stages of one
  algorithm are acceptance checks of one task, not separate tasks.
- A small section is one task: the `final` task with all its files. Most sections are small.
- Tests belong to the task of the code they test. Every task leaves the repository's lint,
  typecheck, and tests green on its own.
- Order the tasks so that a task comes after the tasks it needs.
- Map every behavior and every acceptance check of the section to one task, and every path of its
  `Files:` list to at least one task.
- A `step` task's acceptance runs locally in a few minutes. The `final` task holds the checks of the
  whole change: the repository's required checks, the compose end-to-end test, the security
  checklist, and the evidence that the section asks for in the pull request body.
- Every expected value is a literal in the check (a status code, a count, a hash written out) or an
  independent source that the spec names. It never comes from the file or code that the check
  checks.

## Check and outcome

Run the mechanical check and fix the files until it prints `"ok": true`:

```sh
node scripts/factory-tasks.mjs --check {{variables.work_directory}}/{{issue.id}}
```

Put the number of tasks per repository and the reason for every split in the outcome message.
Transition to `plan-review`.
