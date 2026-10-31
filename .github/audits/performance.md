Periodic performance audit of `main` in [pulse-{repo}](https://github.com/lorenzh/pulse-{repo}). Opened by `factory-audit.yml`. Nothing starts it: the lead decides how it runs.

## Task

Measure the current `main` of pulse-{repo}, not one change. Report evidence, not opinion: every finding has numbers and the command that produced them. Compare with `bench/budgets.json` of pulse-api where a metric is listed there. Items that do not apply to this repository get one line with the reason.

- **Queries.** `EXPLAIN QUERY PLAN` for every query on the request path and at startup. Flag every full table scan (`SCAN`) and every temporary B-tree (`USE TEMP B-TREE`) over results.
- **Startup.** A CPU profile of the startup (`bun --cpu-prof`), with the top functions by self time.
- **Costs that grow with data.** The repository's bench, or a local A/B with a larger data set (for example 10x the bench seed). Report how each measured cost changes with the data size.
- **Memory over time.** RSS after N minutes of steady load, against the RSS at the start. Name N and the load.
- **Tests.** CPU time per test file; name the slowest files.
- **pulse-website only.** JS and CSS size against the budget, and a Lighthouse run of the Home and Hosted pages (performance score, LCP, TBT, CLS).

## Result

One comment here with every item, its command and its numbers. Each finding becomes its own issue with the label `performance`, the command, the measured numbers, and the budget or baseline it misses. Do not fix findings in this issue.
