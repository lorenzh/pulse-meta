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

Keep changes within the section. Do not write `.factory/` or any other notes into this repository.

## Checks and evidence

The review sends the change back when any of the following is missing, so produce all of it in
this run.

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
3. **Security checklist.** For every item that the change touches, name the test or the command
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

Transition to `review` when the change, its checks, and the pull request body are complete.
Use `retry` only when useful work remains for another fresh run.
