# Factory guide: AI Ops role

As of 2026-11-11. This guide only records what we actually experienced with Pulse and grows step by step.

## What the role does

AI Ops keeps the factory running technically: workflows, scripts, tokens and limits, agent failures, and repo instructions. Since 2026-11-11, PM and Architect approve factory PRs. AI Ops is no longer a required reviewer. Before the merge it raises technical concerns, such as failing CI, changes under `.factory/` (also caught by the `guard` check) or side effects on the factory, and it looks in when a PR changes workflows or scripts.

## Experience

### Read first, change later
The first analysis was read-only: runs, logs, open PRs and issues. It showed that docs and reality had drifted apart. The docs said factory version 0.8 while 0.10 was running. The self-hosted runner had been offline for days. Duplicate PRs came from manager rework rather than from a bug. Only after that did we propose individual small fixes.

### Common reasons the factory stalls
We observed these cases:
- Security audit reviews failed on the model's cyber filter.
- An issue (#509) was left without a state after a GraphQL error.
- The sweeper ran rarely because GitHub throttles scheduled (cron) workflows.

The lesson: read the run log before touching prompts.

### Bot token and workflow files
A push that changes `.github/workflows/` needs the `workflow` scope on the gh token. Without it, GitHub rejects the push with "refusing to allow an OAuth App to create or update workflow". Lorenz has to grant the scope himself, using `gh auth refresh -s workflow` with a device code. A connector is not a substitute.

### Enforce rules technically
"The factory never changes `.factory/`" started out as an agreement only. Before writing the path guard (#957), we checked against real data what factory PRs actually touch. Across 109 PRs, every file under `.factory/` was in `.factory/work/<issue>/`. The guard's allowlist follows exactly that finding. A check only signals until it is a required check.

### Branch protection when all bots act as the same user
All bots act as `lorenzh`. Required GitHub reviews could therefore never be satisfied, because nobody can approve their own PR. Approvals therefore happened as review comments plus a log entry in #955. Since 2026-11-11, each role has its own GitHub App. Whether app approvals can count as required approvals here is still open and untested. Technically we enforce it through required checks and a ban on direct pushes to `main`. Before turning protection on, we verified that the factory itself never pushes to `main` directly.

### Reviewing prompt changes under `.factory/`
`.factory/prompts/` has no CI, so the review is the only safeguard. We check:
- whether the parsers in `scripts/` (e.g. the regex for `Files:` and `Behavior change:`) still match,
- whether old specs without the new line keep working,
- whether running runs are affected.

In #958, a new required field would have sent every PR of the running meta-issues back to `implement` once. The fix was to treat a missing field in old specs as the default value and only emit a note.

### State dependencies between bot PRs
When a PR references files from another open PR (#958 references the ADR from #956), put the merge order in the PR body.

## Ways of working that proved useful
- Small PRs on `bot/ai-ops/<topic>` branches, with the role named in the PR body. Lorenz merges them, except guide and report PRs (`factory-guides/`, `pulse-report/`): one other bot approves those, rotating PM, Architect, AI Ops, Release, Security (the next one after the author, so Release reviews AI Ops), and then bots may merge.
- Issues go only into `pulse-meta`; PRs may go to all Pulse repos.
- Log every relevant action briefly in team log #955: who, what, why, link, result.
- Propose fix ideas in the team chat first, then implement them one at a time.
