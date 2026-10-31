Periodic code quality audit of `main` in [pulse-{repo}](https://github.com/lorenzh/pulse-{repo}). Opened by `factory-audit.yml`, which starts the `audit` workflow at once (label `factory/audit/audit`). To stop it, cancel its `Factory run` workflow run and remove the `factory/audit/` label.

## Task

Check the current `main` of pulse-{repo}, not one change. Measure with the repository's own scripts (`package.json`: `lint`, `typecheck`, `test`, `check`) and the shared configuration of pulse-config; add no tool or dependency. Every finding cites file and line and has the command and its output. Items that do not apply to this repository get one line with the reason.

- **Lint and typecheck.** Every finding of the repository's own lint (biome, SonarJS) and typecheck (`tsc`) scripts on `main`.
- **Complexity.** The functions with the highest cognitive complexity, with their value against the budget of the shared configuration.
- **Duplicated logic.** Logic that two or more files of this repository, or this repository and another pulse repository, implement separately.
- **Dead code.** Exports that nothing imports and files that nothing reaches, found with `grep` and `tsc`.
- **Test quality.** Coverage from the repository's own test script where it reports it; risky branches without a test; tests that assert nothing or only mirror the implementation.
- **Error handling.** Swallowed errors (empty or log-only `catch`, ignored promise rejections) and error shapes that differ for the same kind of failure.
- **Consistency.** Deviations from the repository's `AGENTS.md` and from the other services: naming, module layout, configuration handling.
- **Docs against code.** Claims in the README and `docs/` of this repository that the code does not match, each with the claim and the contradicting code.

## Result

The `audit` workflow writes `audits/quality/{repo}.md` and `.json` in pulse-meta (no date in the name: the file holds the current audit, which states its date and examined commits; git history keeps older ones) and opens one report pull request. Every checklist item is `checked`, `not applicable` or `blocked` with its reason. Each finding has a severity (P1-P3), file and line, the command, its exit code and output, and the examined commit; style-only items are notes, never issue candidates, and at most 5 findings are marked as issue candidates. `audit-review` reproduces every P1 and P2 finding. Merging the pull request accepts the report; the owner then decides which candidates become issues. The agent opens no issues and fixes nothing.
