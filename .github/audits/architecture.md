Periodic architecture audit of the whole pulse system. Opened by `factory-audit.yml`, which starts the `audit` workflow at once (label `factory/audit/audit`). To stop it, cancel its `Factory run` workflow run and remove the `factory/audit/` label.

Repositories: [pulse-meta](https://github.com/lorenzh/pulse-meta), [pulse-contract](https://github.com/lorenzh/pulse-contract), [pulse-probe](https://github.com/lorenzh/pulse-probe), [pulse-api](https://github.com/lorenzh/pulse-api), [pulse-status](https://github.com/lorenzh/pulse-status), [pulse-notify](https://github.com/lorenzh/pulse-notify), [pulse-config](https://github.com/lorenzh/pulse-config), [pulse-kit](https://github.com/lorenzh/pulse-kit), [pulse-website](https://github.com/lorenzh/pulse-website).

## Task

Check the current `main` of every repository with machine checks. For every item, record the command and its output, and name the repositories each finding affects.

- **Pin drift.** The commit that each repository pins for pulse-contract, pulse-kit and pulse-config (`github:lorenzh/<name>#<sha>`, and the `check.yml@<sha>` ref), against the newest `main` commit of that repository: how many commits behind, and which of them change the wire or shared behavior.
- **Size.** The largest files and functions: every file over 800 lines and every function over the complexity budget, with its size.
- **Duplicated helpers.** Helpers that two or more repositories implement separately and that belong in pulse-kit.
- **Docs against code.** Claims in each README, `docs/architecture.md` and `docs/development.md` that the code no longer matches, each with the claim and the code that contradicts it.
- **Earlier findings.** Open items of earlier architecture audits that are still true.
- **Dependency direction.** The dependencies between the repositories, against the intended direction in `docs/architecture.md` of pulse-meta; flag every cycle and every dependency in the wrong direction.

## Result

The `audit` workflow writes `audits/architecture/system.md` and `.json` in pulse-meta (no date in the name: the file holds the current audit, which states its date and examined commits; git history keeps older ones) and opens one report pull request. Every checklist item is `checked`, `not applicable` or `blocked` with its reason. Each finding names the affected repositories and has a severity (P1-P3), the command, its exit code and output, and the examined commits; at most 5 are marked as issue candidates. `audit-review` reproduces every P1 and P2 finding. Merging the pull request accepts the report; the owner then decides which candidates become issues. The agent opens no issues and fixes nothing.
