# Audit main

This is a periodic audit of `main`, not of one change. The issue title names the kind and the
scope: `Security audit: pulse-<repo> (<date>)`, `Performance audit: pulse-<repo> (<date>)`,
`Quality audit: pulse-<repo> (<date>)`, or `Architecture audit: pulse (<date>)`. The kind is
`security`, `performance`, `quality`, or `architecture`.
The scope is the repository name without `pulse-` (`notify`), or `system` for an architecture
audit. The issue body holds the checklist.
Read the issue comments for decisions and feedback from earlier runs, including a review that sent
the audit back here.

You audit; you fix nothing. Do not create issues, write comments, or change labels. The report pull
request is the result; after its merge the owner decides which findings become issues. Older audit
issues ask for a comment and one issue per finding in their `## Result` section: the report files
below replace both.

## Where the code is

You work in the meta repository at `{{project.root}}`. Write only the two report files below.
{{#if workspace.contextDirectory}}
Every other repository is cloned read-only at `{{project.root}}/{{workspace.contextDirectory}}/<target>`
(`api`, `probe`, `notify`, ...) at its newest `main`. File search skips the clones, so list or read
them directly. Change nothing under `{{workspace.contextDirectory}}/`: to install, build, run, or
attack a repository, copy it first and work in the copy:

```sh
tmp="$(mktemp -d)"
rsync -a {{project.root}}/{{workspace.contextDirectory}}/<target>/ "$tmp/<target>/"
```

Record the examined commit of every repository you read:
`git -C {{project.root}}/{{workspace.contextDirectory}}/<target> rev-parse HEAD` (meta: `git -C {{project.root}} rev-parse HEAD`).
{{/if}}
Start services only locally, with the repository's own commands (its `docs/development.md`). Never
contact a production or shared system. Stop what you started and remove the copies at the end.

## Time and agents

The state has a hard deadline of 120 minutes (`timeoutMs` of the `auditor` model). Write the start
time down first (`date -u +%T`) and check the clock before every long step. Start no step that can
take more than 15 minutes after minute 75. At minute 100 stop working, write or finish the report
files, and return the outcome. A run that hits the deadline loses everything, including the report.

Do all work in this session. Do not start background tasks or background or parallel subagents: a
subagent result that arrives after you return is lost, and work still running when you return can
replace your structured outcome. If you started a subagent anyway, wait for every one to return
before you write the report. Never return while one is running.

An item that you could not finish in time is `blocked` with the reason ("not finished within the
time budget") and what is left. An unfinished item is never a reason to skip the outcome: always
return the structured outcome, never a prose answer instead.

## What you do

1. Go through every checklist item of the issue body. For each item record one of: `checked` with
   the command or test and its output, `not applicable` with a one-line reason, or `blocked` with
   the reason (for example a tool that the runner lacks). Do not skip an item silently.
2. A finding is something a command proves: the command, its exit code, and an output excerpt that
   shows the problem. A suspicion without such proof is a note, not a finding.
3. Grade each finding: `P1` breaks data, security, or the main flow for most users; `P2` breaks
   documented behavior in a realistic case; `P3` is a corner case that needs a contrived input.
4. Mark at most 5 findings as issue candidates: the ones most worth a fix, highest severity first.
   Every other finding is `note`.

**Performance audits.** First read the latest nightly bench of pulse-api and its budgets:

```sh
run="$(gh run list --repo lorenzh/pulse-api --workflow bench.yml --branch main --status completed --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run download "$run" --repo lorenzh/pulse-api --name bench-out --dir "$(mktemp -d)"
```

and `bench/budgets.json` in the pulse-api clone. Use those numbers where a checklist item has a
bench metric. Measure anew only when you suspect a deviation from the budget or the baseline, in a
copy of pulse-api, and only within this budget:

- at most one A/B comparison per run, with at most 2 rounds per side:
  `timeout 30m bun bench/run.ts --a <sha> --b <sha> --rounds 2` (Docker with Compose; 5 rounds take
  about 35 minutes, so 2 rounds take about 15);
- every other measurement (profile, `EXPLAIN QUERY PLAN`, test CPU, memory over time) runs under
  `timeout`, at most 10 minutes each, with N minutes of load where N is at most 5;
- start them only after the items that need no measurement are written down.

A measurement that does not fit the budget, or that `timeout` stopped (exit 124), is `blocked` with
the reason and the command that would measure it; never keep measuring until the deadline. Every
performance finding gives the value, its unit, the number of repetitions, the baseline it is
compared with, and the budget. Name the bench run you read.

**Quality audits.** Measure with the target's own scripts (`lint`, `typecheck`, `test`, `check` in
its `package.json`) and the shared configuration of pulse-config, in a copy installed with the
repository's own command (for example `npm ci`). Install no other tool or dependency: find dead
code with `grep` and `tsc`, duplication by reading and `grep` across the clones. Every finding
cites file and line. A lint or typecheck error, a swallowed error, or a risky branch without a test
can be a finding; an item that only concerns style (formatting, naming taste) is a note, never an
issue candidate. Run each script under `timeout`, at most 10 minutes each.

**Security audits: disclosure.** The pulse repositories and this report are public. For a `P1` or
`P2` security finding the committed report names the location (file and line), the class (for
example SSRF via redirect), the impact, and the direction of a fix. It contains no working exploit,
payload, or reproduction command. Its `command` field describes the check without the payload (for
example "POST to /admin/x with a body over the limit; status and log line"), and its excerpt shows
the effect, not the input. Keep the full reproduction outside the repository (under `mktemp -d`); it
is not committed and does not survive this run. The reviewer rebuilds the reproduction from the
location and the class. `P3` findings and notes follow the same rule when their command would
work as an attack on a running instance.

## Output

Write two files in the meta repository, `<kind>` and `<scope>` as above. The file names carry no
date: each path always holds the current audit of its scope, and git history keeps the older ones.
`<date>` is today in UTC (`date -u +%F`); it goes into the report body and the finding ids.

- `audits/<kind>/<scope>.md`: the report. Title `# <Kind> audit: pulse-<repo> (<date>)`, or
  `# Architecture audit: pulse (<date>)`. Sections: `## Scope` (audit date, issue number,
  repositories and examined commit SHAs), `## Checklist` (every item of the issue body with
  `checked` / `not applicable` / `blocked` and its evidence or reason), `## Issue candidates`, `## Notes`.
- `audits/<kind>/<scope>.json`: the same findings, machine-readable:

```json
{
  "issue": {{issue.id}},
  "kind": "security",
  "scope": "notify",
  "commits": { "notify": "<sha>", "meta": "<sha>" },
  "checklist": [
    { "item": "<checklist item>", "status": "checked", "evidence": "<command and result, or the reason>" }
  ],
  "findings": [
    {
      "id": "<kind>-<scope>-<date>-1",
      "repos": ["notify"],
      "location": "src/server.ts:120",
      "severity": "P2",
      "candidate": true,
      "title": "<one line>",
      "command": "<command, or the check without the payload for security P1/P2>",
      "exitCode": 1,
      "excerpt": "<output excerpt>",
      "commits": { "notify": "<sha>" }
    }
  ]
}
```

`status` is `checked`, `not applicable`, or `blocked`. Performance findings add `value`, `unit`,
`repetitions`, `baseline`, and `budget`. Security `P1` and `P2` findings add `impact` and
`fixDirection`. At most 5 findings have `"candidate": true`. If a report already exists at
these paths, from an earlier audit or an earlier run of this issue, this run replaces both files. You
may read the old report for context, but verify every finding again on the examined commits; never
copy a finding or its evidence without your own check.

Then transition to `audit-review`. Your outcome message lists the report path, the number of
findings per severity, the issue candidates by id and title, and every `blocked` item. It follows
the disclosure rule above. If a checklist item needs a decision from a person, request a hold with
status `needs-input` instead and name the question.
