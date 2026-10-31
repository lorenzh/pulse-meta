Periodic architecture audit of the whole pulse system. Opened by `factory-audit.yml`. Nothing starts it: the lead decides how it runs.

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

One comment here with every item and its evidence. Each finding becomes its own issue with the label `architecture`, the affected repositories, the command and its output. Do not fix findings in this issue.
