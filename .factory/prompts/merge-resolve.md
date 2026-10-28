# Resolve a base merge

Work on the existing issue branch `{{workspace.branch}}`.
Merge the base commit captured for this run:

```sh
git merge --no-edit {{workspace.baseCommit}}
```

If the merge conflicts, resolve every conflict. Preserve the intent of the issue branch and the
base branch. Inspect the resulting diff. Run the repository checks that cover the resolved files.
Check that the index has no unmerged paths. Check that `{{workspace.baseCommit}}` is an ancestor of
`HEAD`.

Do not merge the pull request. Do not close the issue. Do not rebase or force-push. Factory
publishes the existing branch after this state. Factory also owns the workflow labels and outcome
comment.

If the merge is complete and the checks pass, transition to `review`. If useful resolution work
remains, use `retry`. If the conflict needs a product or design decision, request a `needs-input`
hold. State the decision that a person must make.
