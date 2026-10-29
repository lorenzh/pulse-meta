# Factory and contributing

pulse is built by Paragon Factory agents from issues in this repository. Do not change a target repository by hand for a feature. Write an issue instead.

1. Open a feature issue here. [AGENTS.md](../AGENTS.md) says how to write one.
2. The `spec` workflow (`issue-review`, `plan`, `plan-review`) writes a spec in `.factory/work/<issue>/plan.md` and the target list in `targets.json`. The result is a spec pull request here.
3. Merge the spec pull request to approve the spec.
4. `factory-fan-out.yml` opens one child issue per target, linked as "blocked by" along `dependsOn`, and starts the children that wait for nothing.
5. Each child runs the `build` workflow (`implement`, `review`) in its repository and opens one pull request that says `Closes lorenzh/pulse-meta#<child>`.
6. If the base branch conflicts, run `factory start --issue <child> --workflow merge --apply`.
7. Merge the pull requests. `factory-unblock.yml` starts waiting children and closes the feature when all are done.

Each repository's `AGENTS.md` holds its code conventions (test-driven development, end-to-end tests, lint). Its `docs/development.md` shows the commands.

Back to the [index](index.md).
