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

## The task of this run

Run the task script of the meta repository first:

{{#if workspace.contextDirectory}}
```sh
node {{project.root}}/{{workspace.contextDirectory}}/meta/scripts/factory-tasks.mjs --issue {{issue.id}} --target {{workspace.target}} --base {{workspace.baseCommit}}
```
{{else}}
The meta repository is not cloned in this run: request a hold with status `needs-input`.
{{/if}}

It reads this repository's task file of the approved spec and the run comments of this issue, and
prints JSON: `status`, the task `next` with its entry `task`, `taskBase` (the commit that the task
starts from), and the `rejections` and `retries` of that task. If it exits with an error, request a
hold with status `needs-input` and quote the error. Then follow `status`:

- `no-task-file`: the spec has no task list for this repository (it was approved before task lists
  existed). Implement the whole section in this run, as this prompt says for the final task, and
  transition to `review`.
- `open`: implement the step task `next` and nothing else, then transition to `task-review`.
- `fix-task`: the newest task review rejected task `next`. Fix every finding of that review (the
  newest comment that starts with `Factory ran build/task-review.`), then transition to
  `task-review`.
- `final`: every step task is accepted. Implement the final task, produce all of "Checks and
  evidence" for the whole change, publish the evidence, and transition to `review`.
- `fix-review`: the newest review or security run sent the change back. Fix every finding of that
  run, produce "Checks and evidence" again, update the pull request body, and transition to
  `review`.
- `stuck`: task `next` was rejected three times or retried more than twice. Change no code. Request
  a hold with status `needs-input` that names the task, the counts, the findings of the newest task
  review or what the retries left open, and the question for the person.

Rules for every task:

- Change the files of the task. When the current code needs another file (a renamed file, a caller,
  a shared helper), change it and give the reason in the commit message. Do not re-cut the task
  list: when work must move between tasks, tasks must merge or split, or their order does not work,
  request a hold with status `needs-input` that says why.
- Commit the work of this run yourself. The last line of the commit message is the trailer
  `Task: <id>` (`git commit -m "<what changed>" -m "Task: T2"`). A fix after review takes the id of
  the task that the finding belongs to. Leave no uncommitted change: a commit that the Factory makes
  has no trailer.
- A step task needs no pull request body: the Factory pushes the branch and opens the draft pull
  request when it publishes.
- When a task does not fit one run, commit what passes and return `retry` with what is left in the
  message. The next run continues the same task from `git log <taskBase>..HEAD`.

## No source change

A task requires a behavior change when its `behaviorChange` is `true`. Without a task list, the
section requires one when its line `Behavior change:` says `yes`. A section without that line (a
spec written before it existed) requires one when its required behavior
describes new or changed behavior. A source file is a file that ships or runs the behavior: not a
test, fixture, or doc. A diff that only adds or changes tests, fixtures, or docs is no source
change.

When the task or section requires a behavior change and you find no defect and change no source
file, do not transition to `task-review` or `review`, and do not commit or push. Request a hold
with status `needs-input`.
Its message starts with "The code already has the behavior that the section asks for." and
states:

1. what the spec asked: the section and the line of the spec that you read;
2. what you found: the file and line that already has the behavior;
3. the command or test that shows the current behavior already matches, with its result line;
4. the question for the person: close this issue because the behavior exists, allow a change with
   only regression tests, or name the behavior that is still missing.

After the person answers in the issue comments, follow the answer. For a change with only
regression tests, add tests that pin the behavior, name the comment that allows it in the pull
request body, and transition as the status says. For a missing behavior, implement it as usual.

Keep changes within the section. Do not write `.factory/` or any other notes into this repository.

## Checks and evidence

For a step task (`open`, `fix-task`), run the task's acceptance commands, the repository's required
checks (lint, typecheck, tests), and the mutation step below with `<taskBase>` in place of the
branch base, on the source files of this task. Follow rules 3 and 4 for what the task touches. The
task review checks this; it does not wait for CI.

For the final task, a fix after review, and a spec without a task list, the review sends the change
back when any of the following is missing, so produce all of it in this run, for the whole change.

1. **Acceptance checks.** Run every acceptance check and every check that the spec section names,
   including the repository's compose end-to-end test if it has one (`compose-e2e` in its CI; it
   takes about 3 to 4 minutes). Do not skip a check because it is slow. Run the repository's
   required checks (lint, typecheck, tests) as its `docs/development.md` lists them.
2. **Mutation step.** Prove that each new or changed test checks the new behavior. Copy the working
   tree, put the base version of the changed source files into the copy, and run the new or changed
   tests there:

   ```sh
   tmp="$(mktemp -d)"
   rsync -a --exclude '/.repos/' ./ "$tmp/"
   # For each changed non-test source file: restore its base version, or delete it if it is new.
   git -C "$tmp" checkout {{workspace.baseCommit}} -- <changed source files>
   rm -f "$tmp/<new source file>"
   # Run only the new or changed tests in "$tmp" with the repository's test command.
   ```

   At least one of those tests must fail per behavior change, with an assertion about that
   behavior (not an unrelated setup error). If every test passes on the base version, the tests do
   not prove the change: fix them. A pure refactor or a docs-only change is exempt; say so and why.
   This exemption never applies to a section that requires a behavior change. A change with only
   regression tests that a person allowed (see "No source change") is exempt: its tests pass on
   the base version by design. Say so and name the comment.
3. **Independent expected values.** A new or changed check never derives its expected value from
   the file or code that it checks. Do not read the expected hash, list, count, or snapshot from
   the file under test, and do not regenerate it from the code under test in the same run: such a
   check can never fail. Write the expected value as a literal in the test, or take it from an
   independent source that the spec names. Comparing two artifacts that are produced
   independently is allowed (for example `git diff --exit-code -- dist` after a build, or served
   bytes against the file in `public/`). The rule covers new and changed checks; it does not
   rewrite existing tests.
4. **Security checklist.** For every item that the change touches, name the test or the command
   that proves it holds:
   - secrets and server texts (tokens, header values, SMTP or upstream replies, file contents) never
     reach errors, logs, or responses;
   - authentication runs before any other check, and status codes follow the spec order;
   - body and size limits hold on every method, also before any write;
   - input is validated at every trust boundary, and validators never throw on any input type;
   - no accessor or getter of untrusted input runs;
   - SSRF: allowed targets, redirects (cross-origin, https to http), and which headers are forwarded;
   - file writes are atomic and path-safe;
   - new or changed dependencies are pinned and approved (`docs/approved-packages.md` in meta).

## Publish the evidence

The pull request body carries the evidence: the checks run with their result lines, the mutation
output (or the exemption), the security checklist items with their test or command, and everything
else the spec section asks for (leftover checklist, inventory of removed or changed tests). Keep the
first line `Closes lorenzh/pulse-meta#{{issue.id}}`; without it the merge does not close this
issue. Never paste tokens, environment values, or credentials.

Find the pull request of `{{workspace.branch}}` in this repository. Get `<owner>/<repo>` from
`git remote get-url origin`, then:

```sh
gh api "repos/<owner>/<repo>/pulls?head=<owner>:{{workspace.branch}}&state=open" --jq '.[0].number'
```

- If it exists, write the body to a file outside the repository and replace it:
  `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@<file>`. Do not use `gh pr edit`; it
  fails on the token scopes.
- If it does not exist yet (first run), commit your change on `{{workspace.branch}}`, push it with
  `git push --set-upstream origin {{workspace.branch}}`, and open the draft pull request:
  `gh api -X POST repos/<owner>/<repo>/pulls -f head={{workspace.branch}} -f base={{workspace.base}} -f title=<issue title> -F draft=true -F body=@<file>`.
  The Factory reuses this pull request when it publishes.

`.factory/work/{{issue.id}}/evidence.md` is not an option here: Git never commits `.factory/` in
this repository, and the meta clone is read-only. The pull request body is the only place.

## Outcome

Put the changed files, behavior, check results, the pull request number, and remaining limitations
in the outcome message.

Name the task (`Task: <id>`) and the status of the task script in the outcome message.

Transition to `task-review` when a step task and its checks are complete and committed. Transition
to `review` when the final task, a fix after review, or the section without a task list is complete
with its checks and the pull request body. Never transition without a source change for a task or
section that requires a behavior change, unless a person allowed a change with only regression
tests (see "No source change").
Use `retry` only when useful work remains for another fresh run.
