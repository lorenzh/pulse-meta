# Review a base merge

Review the merge resolution on the existing issue branch `{{workspace.branch}}`. Do not edit the
change under review.

Run this command first:

```sh
git merge-base --is-ancestor {{workspace.baseCommit}} HEAD
```

Inspect the merge and its conflicts. Check that the index has no unmerged paths. Run the repository
checks that cover the resolved files. Always use the captured commit above. The remote base branch
can move after this run starts.

If the captured base is not an ancestor, transition to `resolve`. If the resolution is incorrect or
checks fail, transition to `resolve`. Include the defects and failed checks in the outcome message.
If the merge resolution is correct and checks pass, return `complete`. Completion returns to the
interrupted main workflow. It does not merge the pull request or close the issue. It does not add
`factory/complete`.
