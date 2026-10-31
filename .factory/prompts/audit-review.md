# Review the audit report

The state `audit` wrote a report of this audit issue under `audits/<kind>/` in the meta repository at
`{{project.root}}`: `<date>-<scope>.md` and `<date>-<scope>.json`. Find it with
`grep -l '"issue": {{issue.id}},' {{project.root}}/audits/*/*.json`.
Read the issue body (the checklist) and the issue comments, including the outcome of the audit run.

You are an adversarial reviewer in a fresh session. Your job is to keep only findings that hold.
You may edit the two report files; change nothing else. Do not create issues, write comments, or
change labels.
{{#if workspace.contextDirectory}}
The other repositories are cloned read-only at `{{project.root}}/{{workspace.contextDirectory}}/<target>`.
Change nothing there: copy a repository (`rsync -a` into `mktemp -d`) before you install, build, run,
or attack it. Start services only locally and never contact a production or shared system. Stop what
you started and remove the copies at the end.
{{/if}}

## What you do

1. Check that both files exist, that the `.json` parses (`jq . <file>`), and that it matches the
   `.md`: the same findings, ids, severities, and checklist statuses.
2. Check every finding for the fields it needs: `id`, `repos`, `location` (file and line),
   `severity` (`P1`, `P2`, or `P3`), `command`, `exitCode`, `excerpt`, and `commits`; for
   performance also `value`, `unit`, `repetitions`, `baseline`, and `budget`; for security `P1` and
   `P2` also `impact` and `fixDirection`. At most 5 findings have `"candidate": true`.
3. Check that every checklist item of the issue body appears with `checked`, `not applicable`, or
   `blocked`, and that each `not applicable` or `blocked` reason holds.
4. Check that the examined commit SHAs are the ones of the clones (`git -C <clone> rev-parse HEAD`).
   If `main` moved, re-run on the commit the report names (`git checkout <sha>` in your copy).
5. Run the command of every `P1` and `P2` finding again yourself and compare exit code and output
   with the report. A performance finding is reproduced when the nightly bench run it names shows
   the value, or when your own measurement (`bun bench/run.ts --a <sha> --b <sha>` in a copy of
   pulse-api) confirms the deviation. Spot-check `P3` findings.
6. Check the severity of each finding against its proof: `P1` breaks data, security, or the main
   flow for most users; `P2` breaks documented behavior in a realistic case; `P3` needs a contrived
   input.

**Security disclosure.** The report is public. The committed report must hold no working exploit,
payload, or reproduction command for a `P1` or `P2` security finding: only location, class, impact,
and fix direction. The audit run's local reproduction does not reach this session. Rebuild the
reproduction yourself from the location and the class, keep it outside the repository (under
`mktemp -d`), and do not commit it or quote it in your outcome. Remove any exploit or payload that
the report contains.

## Edits and gates

Edit the report files yourself, in both the `.md` and the `.json`:

- remove a finding whose command you could not reproduce, or whose output does not show the
  problem; list it in your outcome with your command and output;
- correct a severity that its proof does not support, and keep at most 5 issue candidates;
- remove exploit details as above.

Transition to `audit` when any of these holds:

- a file is missing, the `.json` does not parse, or `.md` and `.json` disagree beyond what you fixed;
- a checklist item is missing, or a `not applicable` or `blocked` reason does not hold;
- a finding lacks a required field that you cannot fill from your own reproduction;
- a check that the checklist asks for was not run and could have run on this runner.

Name each gap with what the audit must add.

Return `complete` when every `P1` and `P2` finding is reproduced and no gate holds. A report with no
findings is a valid result. A person then reviews and merges the report pull request and decides
which issue candidates become issues. Include the commands you re-ran with their exit codes, the
findings you removed or regraded, and remaining limitations in the outcome message. The outcome
message follows the disclosure rule above.

The last line of the outcome message is exactly one of these two lines:

```
verdict: ship
verdict: fix first
```

`verdict: ship` goes with `complete`. Every other outcome ends with `verdict: fix first`.
