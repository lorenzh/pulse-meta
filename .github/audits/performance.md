Periodic performance audit of `main` in [pulse-{repo}](https://github.com/lorenzh/pulse-{repo}). Opened by `factory-audit.yml`, which starts the `audit` workflow at once (label `factory/audit/audit`). To stop it, cancel its `Factory run` workflow run and remove the `factory/audit/` label.

## Task

Measure the current `main` of pulse-{repo}, not one change. Report evidence, not opinion: every finding has numbers and the command that produced them. Compare with `bench/budgets.json` of pulse-api where a metric is listed there. Items that do not apply to this repository get one line with the reason.

- **Queries.** `EXPLAIN QUERY PLAN` for every query on the request path and at startup. Flag every full table scan (`SCAN`) and every temporary B-tree (`USE TEMP B-TREE`) over results.
- **Startup.** A CPU profile of the startup (`bun --cpu-prof`), with the top functions by self time.
- **Costs that grow with data.** The repository's bench, or a local A/B with a larger data set (for example 10x the bench seed). Report how each measured cost changes with the data size.
- **Memory over time.** RSS after N minutes of steady load, against the RSS at the start. Name N and the load.
- **Tests.** CPU time per test file; name the slowest files.
- **pulse-website only.** JS and CSS size against the budget, and a Lighthouse run of the Home and Hosted pages (performance score, LCP, TBT, CLS).

## Result

The `audit` workflow writes `audits/performance/{repo}.md` and `.json` in pulse-meta (no date in the name: the file holds the current audit, which states its date and examined commits; git history keeps older ones) and opens one report pull request. It reads the latest nightly bench of pulse-api first and measures anew only on a suspected deviation. Every checklist item is `checked`, `not applicable` or `blocked` with its reason. Each finding has a severity (P1-P3), the command, its exit code and output, the examined commit, and the value, unit, repetitions, baseline and budget; at most 5 are marked as issue candidates. `audit-review` reproduces every P1 and P2 finding. Merging the pull request accepts the report; the owner then decides which candidates become issues. The agent opens no issues and fixes nothing.
